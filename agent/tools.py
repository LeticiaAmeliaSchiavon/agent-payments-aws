"""As 3 ferramentas do agente. Cada uma só chama a Lambda correspondente.

SEGURANÇA: o `usuario_id` NÃO é parâmetro de nenhuma ferramenta, portanto o modelo
nunca o enxerga nem o preenche. Ele vem da sessão autenticada (payload montado pela
Lambda do chat a partir do JWT) e é injetado aqui, no código.
"""
import json
import logging
import os

import boto3
from strands import tool

logger = logging.getLogger(__name__)

MSG_ERRO_INTERNO = "Não foi possível processar a solicitação agora. Tente novamente em instantes."

# nome da variável de ambiente que guarda o nome de cada Lambda (definida pela infra)
_VARIAVEL_DA_FUNCAO = {
    "listar_catalogo": "FUNCAO_LISTAR_CATALOGO",
    "registrar_intencao": "FUNCAO_REGISTRAR_INTENCAO",
    "realizar_compra": "FUNCAO_REALIZAR_COMPRA",
}

_cliente_lambda = None


def _cliente():
    global _cliente_lambda
    if _cliente_lambda is None:
        _cliente_lambda = boto3.client("lambda", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    return _cliente_lambda


def invocar_lambda(nome_tool: str, argumentos: dict, usuario_id: str, cliente=None) -> dict:
    """Chama a Lambda da tool e devolve o resultado como dict. Nunca levanta exceção."""
    # usuario_id vem DEPOIS dos argumentos: nada que o modelo envie consegue sobrescrevê-lo.
    evento = {**argumentos, "usuario_id": usuario_id}
    falha = {"erro": "ERRO_INTERNO", "mensagem": MSG_ERRO_INTERNO}
    if nome_tool == "realizar_compra":
        falha = {"status": "recusado", **falha}
    try:
        resposta = (cliente or _cliente()).invoke(
            FunctionName=os.environ[_VARIAVEL_DA_FUNCAO[nome_tool]],
            Payload=json.dumps(evento).encode("utf-8"),
        )
        corpo = resposta["Payload"].read().decode("utf-8")
        if resposta.get("FunctionError"):
            logger.error("Lambda %s falhou: %s", nome_tool, corpo)  # detalhe só no log
            return falha
        return json.loads(corpo)
    except Exception:
        logger.exception("Erro ao chamar a Lambda %s", nome_tool)
        return falha


def criar_tools(usuario_id: str, cliente=None) -> list:
    """Cria as ferramentas "amarradas" a um usuário (closure), como na Fase 1."""

    def _responder(nome_tool: str, argumentos: dict) -> str:
        resultado = invocar_lambda(nome_tool, argumentos, usuario_id, cliente)
        return json.dumps(resultado, ensure_ascii=False)

    @tool
    def listar_catalogo(categoria: str = "") -> str:
        """Lista os produtos disponíveis para compra, com id, nome, preço e estoque.

        Args:
            categoria: Filtro opcional por categoria (perifericos, audio ou monitores). Deixe vazio para listar tudo.
        """
        return _responder("listar_catalogo", {"categoria": categoria})

    @tool
    def registrar_intencao(produto_id: str, quantidade: int) -> str:
        """Registra a intenção de compra de um produto e devolve o identificador da intenção. Nenhum dinheiro se move aqui.

        Args:
            produto_id: Id do produto, exatamente como veio de listar_catalogo (ex: prod_003).
            quantidade: Quantidade desejada, número inteiro maior que zero.
        """
        return _responder("registrar_intencao", {"produto_id": produto_id, "quantidade": quantidade})

    @tool
    def realizar_compra(intencao_id: str, metodo_pagamento: str) -> str:
        """Executa a compra a partir de uma intenção previamente registrada nesta conversa.

        Args:
            intencao_id: Id devolvido por registrar_intencao nesta conversa. Nunca invente um id.
            metodo_pagamento: Método escolhido pelo usuário: "cartao" ou "pix".
        """
        return _responder("realizar_compra", {"intencao_id": intencao_id, "metodo_pagamento": metodo_pagamento})

    return [listar_catalogo, registrar_intencao, realizar_compra]
