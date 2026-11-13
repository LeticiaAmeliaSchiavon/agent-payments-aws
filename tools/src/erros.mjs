// Falha inesperada: o detalhe vai para o CloudWatch, nunca para o usuário.
export function logarErro(contexto, erro) {
  console.error(JSON.stringify({ contexto, erro: String(erro?.stack ?? erro) }));
}

export const MENSAGEM_ERRO_INTERNO =
  'Não foi possível processar a solicitação agora. Tente novamente em instantes.';
