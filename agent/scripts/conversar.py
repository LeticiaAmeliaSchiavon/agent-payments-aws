"""Conversa pelo terminal com o agente rodando localmente (`uv run python main.py`).

Faz o mesmo que a Lambda do chat fará: a cada turno manda o histórico COMPLETO
(incluindo chamadas de ferramenta e resultados) e guarda as mensagens novas devolvidas.

A conversa inteira também é gravada num arquivo de texto (o caminho aparece ao iniciar),
para você poder consultá-la depois, mesmo que feche o terminal.

Dois modos:
  * local  (padrão):   uv run python scripts/conversar.py --usuario local-1
  * na AWS (runtime):  uv run python scripts/conversar.py --usuario aws-1 --runtime-arn <ARN do runtime>
"""
import argparse
import json
import tempfile
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path


class Registro:
    """Mostra no terminal e, ao mesmo tempo, grava num arquivo."""

    def __init__(self, caminho=None):
        self.caminho = Path(caminho) if caminho else None

    def gravar(self, texto):
        if self.caminho:
            with open(self.caminho, "a", encoding="utf-8") as arquivo:
                arquivo.write(texto)

    def __call__(self, texto="", fim="\n"):
        print(texto, end=fim, flush=True)
        self.gravar(texto + fim)


def eventos_sse(linhas):
    """Lê as linhas de uma resposta SSE e devolve cada evento já convertido de JSON."""
    for bruta in linhas:
        linha = bruta.decode("utf-8").strip() if isinstance(bruta, bytes) else bruta.strip()
        if linha.startswith("data:"):
            yield json.loads(linha[len("data:"):].strip())


def resumo_das_ferramentas(mensagens):
    """Linhas descrevendo as chamadas de ferramenta feitas no turno (para depuração)."""
    saida = []
    for msg in mensagens:
        for bloco in msg.get("content", []):
            if "toolUse" in bloco:
                uso = bloco["toolUse"]
                saida.append(f"  -> {uso['name']}({json.dumps(uso['input'], ensure_ascii=False)})")
            if "toolResult" in bloco:
                for parte in bloco["toolResult"].get("content", []):
                    texto = parte.get("text") or json.dumps(parte.get("json"), ensure_ascii=False)
                    saida.append(f"  <- {texto}")
    return saida


def consumir_eventos(eventos, mostrar):
    """Mostra os eventos de um turno e devolve as mensagens novas (None se houve erro)."""
    novas = None
    for evento in eventos:
        if evento["evento"] == "texto":
            mostrar(evento["texto"], fim="")
        elif evento["evento"] == "erro":
            mostrar(f"\n[erro] {evento['mensagem']}")
            return None
        elif evento["evento"] == "fim":
            novas = evento["mensagens"]
    mostrar()
    for linha in resumo_das_ferramentas(novas or []):
        mostrar(linha)
    return novas


def montar_payload(usuario_id, prompt, historico):
    return json.dumps({"usuario_id": usuario_id, "prompt": prompt, "historico": historico}).encode("utf-8")


def turno(url, usuario_id, prompt, historico, mostrar=None):
    """Um turno contra o agente rodando na sua máquina (HTTP)."""
    mostrar = mostrar or Registro()
    pedido = urllib.request.Request(
        url, data=montar_payload(usuario_id, prompt, historico), headers={"Content-Type": "application/json"}
    )
    mostrar("Agente: ", fim="")
    with urllib.request.urlopen(pedido, timeout=180) as resposta:
        return consumir_eventos(eventos_sse(resposta), mostrar)


def novo_id_de_sessao():
    # A AWS exige no mínimo 33 caracteres; "conversa-" + UUID tem 45.
    return f"conversa-{uuid.uuid4()}"


def turno_aws(cliente, runtime_arn, sessao_id, usuario_id, prompt, historico, mostrar=None):
    """Um turno contra o runtime deployado no AgentCore (assinado com as suas credenciais AWS)."""
    mostrar = mostrar or Registro()
    mostrar("Agente: ", fim="")
    resposta = cliente.invoke_agent_runtime(
        agentRuntimeArn=runtime_arn,
        runtimeSessionId=sessao_id,
        contentType="application/json",
        payload=montar_payload(usuario_id, prompt, historico),
    )
    return consumir_eventos(eventos_sse(resposta["response"].iter_lines()), mostrar)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--usuario", default="local-1", help="usuario_id usado na conversa (cada um tem o próprio limite)")
    parser.add_argument("--url", default="http://localhost:8080/invocations", help="modo local")
    parser.add_argument("--runtime-arn", help="se informado, conversa com o runtime deployado na AWS")
    parser.add_argument("--regiao", default="us-east-1")
    parser.add_argument("--saida", help="arquivo onde a conversa é gravada (padrão: pasta temporária)")
    args = parser.parse_args()

    caminho = args.saida or Path(tempfile.gettempdir()) / (
        f"conversa-{args.usuario}-{datetime.now():%Y%m%d-%H%M%S}.txt"
    )
    mostrar = Registro(caminho)
    print(f"Conversa gravada em: {caminho}")
    mostrar(f"Conversando como '{args.usuario}'. Digite 'sair' para encerrar.\n")

    cliente = sessao_id = None
    if args.runtime_arn:
        import boto3
        from botocore.config import Config

        try:
            # uma só tentativa: repetir a chamada poderia reprocessar o turno
            cliente = boto3.client(
                "bedrock-agentcore", region_name=args.regiao,
                config=Config(read_timeout=180, connect_timeout=10, retries={"mode": "standard", "max_attempts": 1}),
            )
        except Exception as erro:
            print(f"Não consegui preparar a conexão com a AWS: {erro}")
            print('Confira o perfil neste terminal:  $env:AWS_PROFILE = "desafio-1"  (e rode "aws sso login" se preciso)')
            raise SystemExit(1)
        sessao_id = novo_id_de_sessao()
        mostrar(f"Falando com o runtime na AWS: {args.runtime_arn}\n")

    historico = []
    while True:
        try:
            texto = input("Você: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if texto.lower() in {"sair", "exit"}:
            break
        if not texto:
            continue
        mostrar.gravar(f"Você: {texto}\n")
        try:
            if cliente:
                novas = turno_aws(cliente, args.runtime_arn, sessao_id, args.usuario, texto, historico, mostrar)
            else:
                novas = turno(args.url, args.usuario, texto, historico, mostrar)
        except Exception as erro:  # ferramenta de desenvolvimento: mostrar o erro real ajuda a diagnosticar
            mostrar(f"\n[erro ao chamar o agente] {type(erro).__name__}: {erro}")
            novas = None
        if novas:  # só grava no histórico se o turno terminou bem
            historico.extend(novas)
        mostrar()
    print(f"\nConversa salva em: {caminho}")


if __name__ == "__main__":
    main()
