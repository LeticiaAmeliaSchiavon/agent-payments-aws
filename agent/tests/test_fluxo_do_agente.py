"""Roda o agente INTEIRO (loop do Strands + ferramentas + entrypoint) sem chamar a AWS.

O modelo é de mentira: devolve respostas combinadas, no formato de eventos do Bedrock.
As Lambdas também são de mentira. Assim dá para testar o encadeamento de verdade.
"""
import asyncio
import io
import json

import pytest
from strands.models import Model

import main
import tools


def coletar(gerador):
    async def _tudo():
        return [item async for item in gerador]

    return asyncio.run(_tudo())


def fim_de_turno(motivo):
    return [
        {"messageStop": {"stopReason": motivo}},
        {"metadata": {"usage": {"inputTokens": 1, "outputTokens": 1, "totalTokens": 2}, "metrics": {"latencyMs": 1}}},
    ]


def resposta(texto=None, ferramenta=None):
    """Uma resposta do modelo: texto e/ou uma chamada de ferramenta, como eventos do Bedrock."""
    eventos = [{"messageStart": {"role": "assistant"}}]
    if texto:
        eventos += [
            {"contentBlockStart": {"start": {}}},
            {"contentBlockDelta": {"delta": {"text": texto}}},
            {"contentBlockStop": {}},
        ]
    if ferramenta:
        nome, argumentos = ferramenta
        eventos += [
            {"contentBlockStart": {"start": {"toolUse": {"toolUseId": "tool-1", "name": nome}}}},
            {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(argumentos)}}}},
            {"contentBlockStop": {}},
        ]
    return eventos + fim_de_turno("tool_use" if ferramenta else "end_turn")


class ModeloFalso(Model):
    def __init__(self, respostas):
        self._respostas = list(respostas)
        self.system_prompts = []

    def update_config(self, **config):
        pass

    def get_config(self):
        return {}

    async def structured_output(self, output_model, prompt, system_prompt=None, **kwargs):
        raise NotImplementedError

    async def stream(self, messages, tool_specs=None, system_prompt=None, *, tool_choice=None, **kwargs):
        self.system_prompts.append(system_prompt)
        for evento in self._respostas.pop(0):
            yield evento


class FalsoLambda:
    def __init__(self, retorno):
        self.chamadas = []
        self._retorno = retorno

    def invoke(self, FunctionName, Payload):
        self.chamadas.append({"funcao": FunctionName, "evento": json.loads(Payload)})
        return {"Payload": io.BytesIO(json.dumps(self._retorno).encode())}


@pytest.fixture
def ambiente(monkeypatch):
    monkeypatch.setenv("FUNCAO_LISTAR_CATALOGO", "fn-listar")
    monkeypatch.setenv("FUNCAO_REGISTRAR_INTENCAO", "fn-registrar")
    monkeypatch.setenv("FUNCAO_REALIZAR_COMPRA", "fn-comprar")


def montar(monkeypatch, respostas, retorno_lambda):
    modelo, lambda_falsa = ModeloFalso(respostas), FalsoLambda(retorno_lambda)
    monkeypatch.setattr(main, "BedrockModel", lambda **kwargs: modelo)
    monkeypatch.setattr(tools, "_cliente", lambda: lambda_falsa)
    return modelo, lambda_falsa


def test_agente_chama_a_ferramenta_com_o_usuario_da_sessao_e_devolve_o_historico(ambiente, monkeypatch):
    _, lambda_falsa = montar(
        monkeypatch,
        [
            resposta("Vou finalizar.", ("realizar_compra", {"intencao_id": "int_1", "metodo_pagamento": "pix"})),
            resposta("Compra aprovada!"),
        ],
        {"status": "aprovado", "transacao_id": "tx_1"},
    )
    eventos = coletar(main.invoke({"usuario_id": "user-9", "prompt": "pago no pix", "historico": []}))

    # a Lambda recebeu o usuário DA SESSÃO, que o modelo nunca informou
    assert lambda_falsa.chamadas == [
        {"funcao": "fn-comprar",
         "evento": {"intencao_id": "int_1", "metodo_pagamento": "pix", "usuario_id": "user-9"}}
    ]
    fim = eventos[-1]
    assert fim["evento"] == "fim"
    # histórico novo COMPLETO: pergunta, chamada de ferramenta, resultado e resposta final
    assert [m["role"] for m in fim["mensagens"]] == ["user", "assistant", "user", "assistant"]
    blocos = [b for m in fim["mensagens"] for b in m["content"]]
    assert any("toolUse" in b for b in blocos) and any("toolResult" in b for b in blocos)


def test_texto_antes_e_depois_da_ferramenta_nao_fica_colado(ambiente, monkeypatch):
    montar(
        monkeypatch,
        [
            resposta("Vou finalizar sua compra. ✅", ("realizar_compra", {"intencao_id": "int_1", "metodo_pagamento": "pix"})),
            resposta("Compra aprovada!"),
        ],
        {"status": "aprovado"},
    )
    eventos = coletar(main.invoke({"usuario_id": "u", "prompt": "pix", "historico": []}))
    texto = "".join(e["texto"] for e in eventos if e["evento"] == "texto")
    assert texto == "Vou finalizar sua compra. ✅\n\nCompra aprovada!"


def test_resposta_sem_ferramenta_nao_ganha_separador_extra(ambiente, monkeypatch):
    montar(monkeypatch, [resposta("Olá! Como posso ajudar?")], {})
    eventos = coletar(main.invoke({"usuario_id": "u", "prompt": "oi", "historico": []}))
    texto = "".join(e["texto"] for e in eventos if e["evento"] == "texto")
    assert texto == "Olá! Como posso ajudar?"


def test_prompt_do_sistema_chega_ao_modelo(ambiente, monkeypatch):
    modelo, _ = montar(monkeypatch, [resposta("ok")], {})
    coletar(main.invoke({"usuario_id": "u", "prompt": "oi", "historico": []}))
    assert modelo.system_prompts[0] == main.SYSTEM_PROMPT
