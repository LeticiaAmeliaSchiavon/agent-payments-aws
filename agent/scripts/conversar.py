"""Conversa pelo terminal com o agente rodando localmente (`uv run python main.py`).

Faz o mesmo que a Lambda do chat fará: a cada turno manda o histórico COMPLETO
(incluindo chamadas de ferramenta e resultados) e guarda as mensagens novas devolvidas.

Uso:  uv run python scripts/conversar.py [--usuario local-1]
"""
import argparse
import json
import urllib.request


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


def turno(url, usuario_id, prompt, historico):
    corpo = json.dumps({"usuario_id": usuario_id, "prompt": prompt, "historico": historico}).encode("utf-8")
    pedido = urllib.request.Request(url, data=corpo, headers={"Content-Type": "application/json"})
    novas = None
    print("Agente: ", end="", flush=True)
    with urllib.request.urlopen(pedido, timeout=180) as resposta:
        for evento in eventos_sse(resposta):
            if evento["evento"] == "texto":
                print(evento["texto"], end="", flush=True)
            elif evento["evento"] == "erro":
                print(f"\n[erro] {evento['mensagem']}")
                return None
            elif evento["evento"] == "fim":
                novas = evento["mensagens"]
    print()
    for linha in resumo_das_ferramentas(novas or []):
        print(linha)
    return novas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--usuario", default="local-1", help="usuario_id usado na conversa (cada um tem o próprio limite)")
    parser.add_argument("--url", default="http://localhost:8080/invocations")
    args = parser.parse_args()

    historico = []
    print(f"Conversando como '{args.usuario}'. Digite 'sair' para encerrar.\n")
    while True:
        try:
            texto = input("Você: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if texto.lower() in {"sair", "exit"}:
            break
        if not texto:
            continue
        novas = turno(args.url, args.usuario, texto, historico)
        if novas:  # só grava no histórico se o turno terminou bem
            historico.extend(novas)
        print()


if __name__ == "__main__":
    main()
