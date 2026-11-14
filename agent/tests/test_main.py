import asyncio

import main


def coletar(gerador):
    async def _tudo():
        return [item async for item in gerador]

    return asyncio.run(_tudo())


class AgenteFalso:
    """Imita o Agent do Strands: já nasce com o histórico e acrescenta as mensagens novas."""

    def __init__(self, historico, pedacos, falhar=False):
        self.messages = list(historico)
        self._pedacos = pedacos
        self._falhar = falhar

    async def stream_async(self, prompt):
        self.messages.append({"role": "user", "content": [{"text": prompt}]})
        for p in self._pedacos:
            yield {"data": p}
        yield {"evento_interno": "ignorado"}  # eventos sem "data" não viram texto
        if self._falhar:
            raise RuntimeError("detalhe interno secreto")
        self.messages.append({"role": "assistant", "content": [{"text": "".join(self._pedacos)}]})


def test_sem_usuario_id_devolve_erro_e_nao_cria_agente(monkeypatch):
    monkeypatch.setattr(main, "criar_agente", lambda *a: (_ for _ in ()).throw(AssertionError("não devia criar")))
    for payload in [{"prompt": "oi"}, {"usuario_id": "", "prompt": "oi"}, {"usuario_id": 123, "prompt": "oi"}]:
        eventos = coletar(main.invoke(payload))
        assert eventos == [{"evento": "erro", "mensagem": "Sessão sem usuário identificado."}]


def test_mensagem_vazia_devolve_erro(monkeypatch):
    monkeypatch.setattr(main, "criar_agente", lambda *a: (_ for _ in ()).throw(AssertionError("não devia criar")))
    eventos = coletar(main.invoke({"usuario_id": "u", "prompt": "   "}))
    assert eventos == [{"evento": "erro", "mensagem": "Mensagem vazia."}]


def test_streaming_envia_pedacos_e_no_fim_so_as_mensagens_novas(monkeypatch):
    historico = [
        {"role": "user", "content": [{"text": "oi"}]},
        {"role": "assistant", "content": [{"text": "olá"}]},
    ]
    recebido = {}

    def fabrica(usuario_id, hist):
        recebido["usuario_id"], recebido["historico"] = usuario_id, hist
        return AgenteFalso(hist, ["Claro", ", ", "posso ajudar"])

    monkeypatch.setattr(main, "criar_agente", fabrica)
    eventos = coletar(main.invoke({"usuario_id": "user-9", "prompt": "o que tem?", "historico": historico}))

    assert recebido["usuario_id"] == "user-9"
    assert recebido["historico"] == historico  # histórico completo chega ao agente
    textos = [e["texto"] for e in eventos if e["evento"] == "texto"]
    assert textos == ["Claro", ", ", "posso ajudar"]
    fim = eventos[-1]
    assert fim["evento"] == "fim"
    assert [m["role"] for m in fim["mensagens"]] == ["user", "assistant"]  # só as 2 novas
    assert fim["mensagens"][0]["content"][0]["text"] == "o que tem?"


def test_falha_no_meio_nao_vaza_detalhe_e_nao_manda_mensagens_para_gravar(monkeypatch):
    monkeypatch.setattr(main, "criar_agente", lambda u, h: AgenteFalso(h, ["a"], falhar=True))
    eventos = coletar(main.invoke({"usuario_id": "u", "prompt": "oi"}))
    assert eventos[-1]["evento"] == "erro"
    assert "secreto" not in str(eventos)
    assert not any(e["evento"] == "fim" for e in eventos)  # histórico não é corrompido


def test_agente_real_e_montado_com_historico_completo_e_ferramentas_do_usuario(monkeypatch):
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    historico = [{"role": "user", "content": [{"text": f"m{i}"}]} if i % 2 == 0
                 else {"role": "assistant", "content": [{"text": f"r{i}"}]} for i in range(60)]
    agente = main.criar_agente("user-1", historico)
    assert len(agente.messages) == 60  # nada é descartado (sem janela deslizante)
    assert sorted(agente.tool_names) == ["listar_catalogo", "realizar_compra", "registrar_intencao"]
