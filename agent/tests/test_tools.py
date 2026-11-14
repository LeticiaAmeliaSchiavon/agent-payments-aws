import io
import json

import pytest

import tools


class FalsoLambda:
    """Imita o client do boto3 e guarda tudo que foi enviado."""

    def __init__(self, resposta=None, function_error=None, levantar=None):
        self.chamadas = []
        self._resposta = resposta if resposta is not None else {"ok": True}
        self._function_error = function_error
        self._levantar = levantar

    def invoke(self, FunctionName, Payload):
        if self._levantar:
            raise self._levantar
        self.chamadas.append({"funcao": FunctionName, "evento": json.loads(Payload)})
        retorno = {"Payload": io.BytesIO(json.dumps(self._resposta).encode())}
        if self._function_error:
            retorno["FunctionError"] = self._function_error
        return retorno


@pytest.fixture(autouse=True)
def variaveis(monkeypatch):
    monkeypatch.setenv("FUNCAO_LISTAR_CATALOGO", "fn-listar")
    monkeypatch.setenv("FUNCAO_REGISTRAR_INTENCAO", "fn-registrar")
    monkeypatch.setenv("FUNCAO_REALIZAR_COMPRA", "fn-comprar")


def por_nome(lista, nome):
    return next(t for t in lista if t.tool_name == nome)


def test_sao_exatamente_tres_ferramentas():
    nomes = sorted(t.tool_name for t in tools.criar_tools("user-1", FalsoLambda()))
    assert nomes == ["listar_catalogo", "realizar_compra", "registrar_intencao"]


def test_usuario_id_nao_existe_no_esquema_que_o_modelo_enxerga():
    for t in tools.criar_tools("user-1", FalsoLambda()):
        propriedades = t.tool_spec["inputSchema"]["json"]["properties"]
        assert "usuario_id" not in propriedades, t.tool_name
        assert "user_id" not in propriedades, t.tool_name


def test_esquema_de_cada_ferramenta_tem_so_os_campos_do_contrato():
    lista = tools.criar_tools("user-1", FalsoLambda())
    campos = lambda n: set(por_nome(lista, n).tool_spec["inputSchema"]["json"]["properties"])
    assert campos("listar_catalogo") == {"categoria"}
    assert campos("registrar_intencao") == {"produto_id", "quantidade"}
    assert campos("realizar_compra") == {"intencao_id", "metodo_pagamento"}


def test_usuario_id_da_sessao_e_injetado_na_chamada_da_lambda():
    falso = FalsoLambda({"status": "aprovado"})
    lista = tools.criar_tools("user-abc", falso)
    por_nome(lista, "realizar_compra")(intencao_id="int_1", metodo_pagamento="pix")
    chamada = falso.chamadas[0]
    assert chamada["funcao"] == "fn-comprar"
    assert chamada["evento"] == {"intencao_id": "int_1", "metodo_pagamento": "pix", "usuario_id": "user-abc"}


def test_cada_usuario_tem_suas_proprias_ferramentas():
    falso_a, falso_b = FalsoLambda(), FalsoLambda()
    por_nome(tools.criar_tools("A", falso_a), "registrar_intencao")(produto_id="prod_001", quantidade=1)
    por_nome(tools.criar_tools("B", falso_b), "registrar_intencao")(produto_id="prod_001", quantidade=1)
    assert falso_a.chamadas[0]["evento"]["usuario_id"] == "A"
    assert falso_b.chamadas[0]["evento"]["usuario_id"] == "B"


def test_argumento_malicioso_chamado_usuario_id_nao_sobrescreve_o_da_sessao():
    falso = FalsoLambda()
    tools.invocar_lambda("realizar_compra", {"intencao_id": "x", "usuario_id": "hacker"}, "user-real", falso)
    assert falso.chamadas[0]["evento"]["usuario_id"] == "user-real"


def test_devolve_ao_modelo_exatamente_o_json_da_lambda():
    resposta = {"status": "recusado", "erro": "LIMITE_EXCEDIDO", "mensagem": "Passou do limite."}
    saida = por_nome(tools.criar_tools("u", FalsoLambda(resposta)), "realizar_compra")(
        intencao_id="i", metodo_pagamento="cartao"
    )
    assert json.loads(saida) == resposta


def test_falha_da_lambda_vira_mensagem_amigavel_sem_stack_trace():
    falso = FalsoLambda({"errorMessage": "boom", "stackTrace": ["linha 1"]}, function_error="Unhandled")
    saida = por_nome(tools.criar_tools("u", falso), "registrar_intencao")(produto_id="prod_001", quantidade=1)
    dados = json.loads(saida)
    assert dados["erro"] == "ERRO_INTERNO"
    assert "stackTrace" not in saida and "boom" not in saida


def test_excecao_de_rede_vira_mensagem_amigavel():
    falso = FalsoLambda(levantar=RuntimeError("timeout de rede secreto"))
    saida = por_nome(tools.criar_tools("u", falso), "realizar_compra")(intencao_id="i", metodo_pagamento="pix")
    dados = json.loads(saida)
    assert dados["status"] == "recusado" and dados["erro"] == "ERRO_INTERNO"
    assert "secreto" not in saida


def test_metodo_invalido_chega_ate_a_lambda_para_o_backend_decidir():
    falso = FalsoLambda({"status": "recusado", "erro": "METODO_INVALIDO"})
    por_nome(tools.criar_tools("u", falso), "realizar_compra")(intencao_id="i", metodo_pagamento="boleto")
    assert falso.chamadas[0]["evento"]["metodo_pagamento"] == "boleto"
