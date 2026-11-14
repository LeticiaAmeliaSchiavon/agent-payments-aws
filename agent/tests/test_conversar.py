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
