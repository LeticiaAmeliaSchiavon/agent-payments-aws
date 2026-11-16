// Ponto de entrada da Lambda do chat (resposta em streaming). A lógica fica em chat-core.mjs.
import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { processarChat } from './chat-core.mjs';
import { cabecalhosCors, extrairUsuarioId, lerMensagem } from './http.mjs';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const agentClient = new BedrockAgentCoreClient({});

function responderJson(responseStream, status, corpo, cors) {
  const saida = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
  saida.write(JSON.stringify(corpo));
  saida.end();
}

export const handler = awslambda.streamifyResponse(async (evento, responseStream) => {
  const cors = cabecalhosCors(evento, process.env.ALLOWED_ORIGIN);

  const usuarioId = extrairUsuarioId(evento);
  if (!usuarioId) return responderJson(responseStream, 401, { erro: 'Não autenticado.' }, cors);

  const { mensagem, erro } = lerMensagem(evento);
  if (erro) return responderJson(responseStream, 400, { erro }, cors);

  const saida = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', ...cors },
  });
  await processarChat({
    usuarioId,
    mensagem,
    ddb,
    tabelaConversas: process.env.CONVERSAS_TABLE,
    runtimeArn: process.env.AGENT_RUNTIME_ARN,
    agentClient,
    enviar: (evento) => saida.write(`data: ${JSON.stringify(evento)}\n\n`),
  });
  saida.end();
});
