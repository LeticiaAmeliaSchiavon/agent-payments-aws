"""Agente de compras: Strands + Amazon Bedrock, servido pelo AgentCore Runtime.

Entrada (payload montado pela Lambda do chat, que é o único que pode invocar o runtime):
    {"usuario_id": "<sub do Cognito>", "prompt": "<mensagem>", "historico": [<mensagens anteriores>]}

Saída (streaming): eventos {"evento": "texto", "texto": "..."} e, ao final,
    {"evento": "fim", "mensagens": [<mensagens novas, com chamadas de ferramenta>]}
ou {"evento": "erro", "mensagem": "..."}.
"""
import logging
import os

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent
from strands.agent.conversation_manager import NullConversationManager
from strands.models import BedrockModel

from prompt import SYSTEM_PROMPT
from tools import MSG_ERRO_INTERNO, criar_tools

logger = logging.getLogger(__name__)

MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
REGION = os.environ.get("AWS_REGION", "us-east-1")

app = BedrockAgentCoreApp()


def criar_agente(usuario_id: str, historico: list) -> Agent:
    return Agent(
        model=BedrockModel(model_id=MODEL_ID, region_name=REGION, temperature=0.2),
        system_prompt=SYSTEM_PROMPT,
        tools=criar_tools(usuario_id),
        messages=historico,  # histórico COMPLETO, incluindo chamadas de ferramenta e resultados
        # Sem janela deslizante: o padrão do Strands descarta mensagens antigas.
        conversation_manager=NullConversationManager(),
        callback_handler=None,  # não imprimir no stdout; o texto sai pelo streaming
    )


@app.entrypoint
async def invoke(payload):
    usuario_id = payload.get("usuario_id")
    prompt = payload.get("prompt")
    historico = payload.get("historico") or []

    if not isinstance(usuario_id, str) or not usuario_id.strip():
        yield {"evento": "erro", "mensagem": "Sessão sem usuário identificado."}
        return
    if not isinstance(prompt, str) or not prompt.strip():
        yield {"evento": "erro", "mensagem": "Mensagem vazia."}
        return

    try:
        agente = criar_agente(usuario_id, historico)
        quantas_ja_existiam = len(agente.messages)
        enviou_texto = False
        novo_ciclo = False
        async for evento in agente.stream_async(prompt):
            if evento.get("start_event_loop") and enviou_texto:
                novo_ciclo = True  # o agente voltou a falar depois de usar uma ferramenta
            if "data" in evento:  # pedaço de texto da resposta
                texto = evento["data"]
                if novo_ciclo:
                    texto = "\n\n" + texto  # sem isso o texto de antes e o de depois da ferramenta ficam colados
                    novo_ciclo = False
                enviou_texto = True
                yield {"evento": "texto", "texto": texto}
    except Exception:
        # Detalhe só no log (CloudWatch). Nada de stack trace para o usuário.
        logger.exception("Falha ao processar a mensagem")
        yield {"evento": "erro", "mensagem": MSG_ERRO_INTERNO}
        return

    yield {"evento": "fim", "mensagens": agente.messages[quantas_ja_existiam:]}


if __name__ == "__main__":
    app.run()
