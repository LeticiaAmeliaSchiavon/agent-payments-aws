import json

from scripts.conversar import eventos_sse, resumo_das_ferramentas


def test_le_eventos_sse_ignorando_linhas_vazias():
    linhas = [
        b'data: {"evento": "texto", "texto": "Ol\xc3\xa1"}\n',
        b"\n",
        b'data: {"evento": "fim", "mensagens": []}\n',
    ]
    eventos = list(eventos_sse(linhas))
    assert eventos[0] == {"evento": "texto", "texto": "Olá"}
    assert eventos[1]["evento"] == "fim"


def test_resumo_mostra_chamadas_e_resultados_das_ferramentas():
    mensagens = [
        {"role": "assistant", "content": [{"toolUse": {"name": "realizar_compra",
                                                       "input": {"intencao_id": "int_1", "metodo_pagamento": "pix"}}}]},
        {"role": "user", "content": [{"toolResult": {"content": [{"text": json.dumps({"status": "aprovado"})}]}}]},
        {"role": "assistant", "content": [{"text": "Pronto!"}]},
    ]
    linhas = resumo_das_ferramentas(mensagens)
    assert linhas[0].startswith("  -> realizar_compra(")
    assert "usuario_id" not in linhas[0]  # o modelo nunca manda o usuário
    assert linhas[1] == '  <- {"status": "aprovado"}'
    assert len(linhas) == 2


# ---------- fluxo completo contra um servidor de mentira ----------
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from scripts.conversar import Registro, turno


def test_turno_mostra_o_texto_manda_o_historico_e_grava_o_arquivo(tmp_path):
    recebidos = []

    class Falso(BaseHTTPRequestHandler):
        def do_POST(self):
            recebidos.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            eventos = [
                {"evento": "texto", "texto": "Olá"},
                {"evento": "texto", "texto": " mundo"},
                {"evento": "fim", "mensagens": [{"role": "assistant", "content": [{"text": "Olá mundo"}]}]},
            ]
            for e in eventos:
                self.wfile.write(f"data: {json.dumps(e, ensure_ascii=False)}\n\n".encode("utf-8"))

        def log_message(self, *args):
            pass

    servidor = HTTPServer(("127.0.0.1", 0), Falso)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    arquivo = tmp_path / "conversa.txt"
    anterior = [{"role": "user", "content": [{"text": "oi"}]}]
    try:
        novas = turno(f"http://127.0.0.1:{servidor.server_port}/invocations", "user-7", "e agora?",
                      anterior, Registro(arquivo))
    finally:
        servidor.shutdown()

    assert recebidos[0] == {"usuario_id": "user-7", "prompt": "e agora?", "historico": anterior}
    assert novas == [{"role": "assistant", "content": [{"text": "Olá mundo"}]}]
    assert "Agente: Olá mundo" in arquivo.read_text(encoding="utf-8")


# ---------- modo AWS (runtime deployado), com um cliente boto3 de mentira ----------
from scripts.conversar import novo_id_de_sessao, turno_aws


class CorpoFalso:
    def __init__(self, eventos):
        self._linhas = []
        for e in eventos:
            self._linhas += [f"data: {json.dumps(e, ensure_ascii=False)}".encode("utf-8"), b""]

    def iter_lines(self):
        return iter(self._linhas)


class ClienteAwsFalso:
    def __init__(self, eventos):
        self.chamadas = []
        self._eventos = eventos

    def invoke_agent_runtime(self, **kwargs):
        self.chamadas.append(kwargs)
        return {"response": CorpoFalso(self._eventos), "statusCode": 200}


def test_id_de_sessao_tem_o_minimo_de_33_caracteres_e_e_unico():
    ids = {novo_id_de_sessao() for _ in range(50)}
    assert len(ids) == 50
    assert all(len(i) >= 33 for i in ids)


def test_turno_aws_chama_o_runtime_com_o_payload_certo_e_mostra_a_resposta(tmp_path):
    cliente = ClienteAwsFalso([
        {"evento": "texto", "texto": "Oi!"},
        {"evento": "fim", "mensagens": [{"role": "assistant", "content": [{"text": "Oi!"}]}]},
    ])
    arquivo = tmp_path / "c.txt"
    anterior = [{"role": "user", "content": [{"text": "a"}]}]
    novas = turno_aws(cliente, "arn:aws:bedrock-agentcore:us-east-1:1:runtime/x", novo_id_de_sessao(),
                      "user-5", "oi", anterior, Registro(arquivo))

    chamada = cliente.chamadas[0]
    assert chamada["agentRuntimeArn"].endswith("runtime/x")
    assert len(chamada["runtimeSessionId"]) >= 33
    assert json.loads(chamada["payload"]) == {"usuario_id": "user-5", "prompt": "oi", "historico": anterior}
    assert novas == [{"role": "assistant", "content": [{"text": "Oi!"}]}]
    assert "Agente: Oi!" in arquivo.read_text(encoding="utf-8")


def test_turno_aws_com_evento_de_erro_devolve_none_e_registra_o_erro(tmp_path):
    cliente = ClienteAwsFalso([{"evento": "erro", "mensagem": "Algo deu errado."}])
    arquivo = tmp_path / "c.txt"
    assert turno_aws(cliente, "arn", novo_id_de_sessao(), "u", "oi", [], Registro(arquivo)) is None
    assert "[erro] Algo deu errado." in arquivo.read_text(encoding="utf-8")
