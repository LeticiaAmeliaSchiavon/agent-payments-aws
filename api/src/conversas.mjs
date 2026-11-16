// Lambda de GET /conversas: devolve o histórico do usuário autenticado, pronto para a tela.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { carregarHistorico, paraExibicao } from './historico.mjs';
import { cabecalhosCors, extrairUsuarioId } from './http.mjs';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const resposta = (statusCode, corpo, cors) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  body: JSON.stringify(corpo),
});

export async function listarConversas(evento, { ddb: banco = ddb, tabela = process.env.CONVERSAS_TABLE, log = console } = {}) {
  const cors = cabecalhosCors(evento, process.env.ALLOWED_ORIGIN);
  const usuarioId = extrairUsuarioId(evento);
  if (!usuarioId) return resposta(401, { erro: 'Não autenticado.' }, cors);
  try {
    const mensagens = await carregarHistorico(banco, tabela, usuarioId);
    return resposta(200, { mensagens: paraExibicao(mensagens) }, cors);
  } catch (erro) {
    log.error(JSON.stringify({ contexto: 'conversas', usuarioId, erro: String(erro?.stack ?? erro) }));
    return resposta(500, { erro: 'Não foi possível carregar a conversa agora.' }, cors);
  }
}

export const handler = (evento) => listarConversas(evento);
