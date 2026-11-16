import { obterIdToken } from './auth.js';
import { config } from './config.js';

export const MENSAGEM_SESSAO_EXPIRADA = 'Sua sessão expirou. Saia e entre novamente.';
export const MENSAGEM_GENERICA = 'Não foi possível falar com o servidor agora. Tente novamente em instantes.';

export class ErroDeApi extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.name = 'ErroDeApi';
    this.status = status;
  }
}

async function erroDaResposta(resposta) {
  if (resposta.status === 401 || resposta.status === 403) return new ErroDeApi(MENSAGEM_SESSAO_EXPIRADA, resposta.status);
  if (resposta.status === 429) {
    return new ErroDeApi('Muitas mensagens em pouco tempo. Aguarde um instante e tente de novo.', 429);
  }
  if (resposta.status === 400) {
    const dados = await resposta.json().catch(() => ({}));
    return new ErroDeApi(dados.erro || 'Mensagem inválida.', 400);
  }
  return new ErroDeApi(MENSAGEM_GENERICA, resposta.status);
}

async function cabecalhos() {
  try {
    // O PDF pede "Authorization: Bearer <token>".
    return { Authorization: `Bearer ${await obterIdToken()}`, 'Content-Type': 'application/json' };
  } catch {
    throw new ErroDeApi(MENSAGEM_SESSAO_EXPIRADA, 401);
  }
}

/** Lê um stream SSE ("data: {json}") e devolve cada evento, mesmo quando ele chega partido entre pedaços. */
export async function* lerEventosSse(corpo) {
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder('utf-8');
  let resto = '';
  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      resto += decodificador.decode(value, { stream: true });
      let posicao;
      while ((posicao = resto.indexOf('\n')) >= 0) {
        const linha = resto.slice(0, posicao).trim();
        resto = resto.slice(posicao + 1);
        if (linha.startsWith('data:')) yield JSON.parse(linha.slice('data:'.length).trim());
      }
    }
    const ultima = resto.trim();
    if (ultima.startsWith('data:')) yield JSON.parse(ultima.slice('data:'.length).trim());
  } finally {
    leitor.releaseLock();
  }
}

/** GET /conversas: o histórico do usuário logado, já pronto para a tela. */
export async function carregarConversas(fetchImpl = fetch) {
  let resposta;
  try {
    resposta = await fetchImpl(`${config.apiUrl}/conversas`, { headers: await cabecalhos() });
  } catch (erro) {
    if (erro instanceof ErroDeApi) throw erro;
    throw new ErroDeApi(MENSAGEM_GENERICA);
  }
  if (!resposta.ok) throw await erroDaResposta(resposta);
  const dados = await resposta.json();
  return dados.mensagens ?? [];
}

/**
 * POST /chat: manda SÓ a mensagem nova (o histórico vive no servidor) e devolve os eventos do stream
 * ({evento: 'texto' | 'fim' | 'erro', ...}) à medida que chegam.
 */
export async function* enviarMensagem(mensagem, fetchImpl = fetch) {
  let resposta;
  try {
    resposta = await fetchImpl(`${config.apiUrl}/chat`, {
      method: 'POST',
      headers: await cabecalhos(),
      body: JSON.stringify({ mensagem }),
    });
  } catch (erro) {
    if (erro instanceof ErroDeApi) throw erro;
    throw new ErroDeApi(MENSAGEM_GENERICA);
  }
  if (!resposta.ok) throw await erroDaResposta(resposta);
  yield* lerEventosSse(resposta.body);
}
