export const TAMANHO_MAXIMO_DA_MENSAGEM = 2000;

/**
 * O usuário vem EXCLUSIVAMENTE das claims do token que o API Gateway já validou (o `sub` do Cognito).
 * Nada do corpo da requisição é usado para identificar quem está falando.
 */
export function extrairUsuarioId(evento) {
  const sub = evento?.requestContext?.authorizer?.claims?.sub;
  return typeof sub === 'string' && sub ? sub : null;
}

export function lerMensagem(evento) {
  let corpo = evento?.body ?? '';
  if (evento?.isBase64Encoded) corpo = Buffer.from(corpo, 'base64').toString('utf-8');
  let dados;
  try {
    dados = JSON.parse(corpo);
  } catch {
    return { erro: 'Corpo da requisição inválido.' };
  }
  const mensagem = dados?.mensagem;
  if (typeof mensagem !== 'string' || !mensagem.trim()) return { erro: 'Envie {"mensagem": "..."}.' };
  if (mensagem.length > TAMANHO_MAXIMO_DA_MENSAGEM) {
    return { erro: `Mensagem muito longa (máximo ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres).` };
  }
  return { mensagem: mensagem.trim() };
}

/** CORS: só a origem do app é aceita. Qualquer outra não recebe o cabeçalho e o navegador bloqueia. */
export function cabecalhosCors(evento, origemPermitida) {
  const origem = evento?.headers?.origin ?? evento?.headers?.Origin;
  if (origem && origemPermitida && origem === origemPermitida) {
    return { 'Access-Control-Allow-Origin': origem, Vary: 'Origin' };
  }
  return { Vary: 'Origin' };
}
