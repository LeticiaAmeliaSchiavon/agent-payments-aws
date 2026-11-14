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
