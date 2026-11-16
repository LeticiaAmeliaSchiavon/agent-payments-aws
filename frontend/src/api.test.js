import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth.js', () => ({ obterIdToken: vi.fn() }));
vi.mock('./config.js', () => ({ config: { apiUrl: 'https://api.exemplo.com/prod' } }));

import { obterIdToken } from './auth.js';
import { carregarConversas, enviarMensagem, ErroDeApi, lerEventosSse, MENSAGEM_GENERICA, MENSAGEM_SESSAO_EXPIRADA } from './api.js';

const codificador = new TextEncoder();
const fluxo = (...partes) =>
  new ReadableStream({
    start(controle) {
      for (const p of partes) controle.enqueue(typeof p === 'string' ? codificador.encode(p) : p);
      controle.close();
    },
  });
const sse = (...eventos) => eventos.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
async function coletar(gerador) {
  const lidos = [];
  for await (const e of gerador) lidos.push(e);
  return lidos;
}
/** Resposta HTTP de mentira. */
const resposta = (status, { corpo, json } = {}) => ({ ok: status >= 200 && status < 300, status, body: corpo, json: async () => json });

beforeEach(() => {
  obterIdToken.mockReset();
  obterIdToken.mockResolvedValue('TOKEN-DO-USUARIO');
});

describe('lerEventosSse', () => {
  it('junta um evento partido entre pedaços', async () => {
    const texto = sse({ evento: 'texto', texto: 'Olá, mundo' }, { evento: 'fim' });
    const lidos = await coletar(lerEventosSse(fluxo(texto.slice(0, 17), texto.slice(17))));
    expect(lidos.map((e) => e.evento)).toEqual(['texto', 'fim']);
    expect(lidos[0].texto).toBe('Olá, mundo');
  });

  it('não quebra um caractere acentuado partido ao meio', async () => {
    const bytes = codificador.encode(sse({ evento: 'texto', texto: 'ação' }));
    const meio = bytes.indexOf(0xc3) + 1; // entre os dois bytes de "ç"
    const lidos = await coletar(lerEventosSse(fluxo(bytes.slice(0, meio), bytes.slice(meio))));
    expect(lidos[0].texto).toBe('ação');
  });
});

describe('enviarMensagem', () => {
  it('manda SÓ a mensagem nova, com Bearer, para /chat, e devolve os eventos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      resposta(200, { corpo: fluxo(sse({ evento: 'texto', texto: 'Oi' }, { evento: 'fim' })) }),
    );
    const eventos = await coletar(enviarMensagem('quero o mouse', fetchImpl));

    const [url, opcoes] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.exemplo.com/prod/chat'); // sem barra dupla
    expect(opcoes.method).toBe('POST');
    expect(opcoes.headers.Authorization).toBe('Bearer TOKEN-DO-USUARIO');
    // o histórico NÃO vai no corpo: ele vive no servidor
    expect(JSON.parse(opcoes.body)).toEqual({ mensagem: 'quero o mouse' });
    expect(eventos.map((e) => e.evento)).toEqual(['texto', 'fim']);
  });

  it.each([
    [401, MENSAGEM_SESSAO_EXPIRADA],
    [403, MENSAGEM_SESSAO_EXPIRADA],
    [429, /Muitas mensagens/],
    [500, MENSAGEM_GENERICA],
    [502, MENSAGEM_GENERICA],
  ])('status %s vira uma mensagem compreensível', async (status, esperado) => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta(status));
    const erro = await coletar(enviarMensagem('oi', fetchImpl)).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroDeApi);
    expect(erro.status).toBe(status);
    typeof esperado === 'string' ? expect(erro.message).toBe(esperado) : expect(erro.message).toMatch(esperado);
  });

  it('400 repassa o motivo dado pelo servidor', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta(400, { json: { erro: 'Mensagem muito longa (máximo 2000 caracteres).' } }));
    const erro = await coletar(enviarMensagem('oi', fetchImpl)).catch((e) => e);
    expect(erro.message).toMatch(/muito longa/);
  });

  it('falha de rede vira mensagem genérica, sem detalhe técnico', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const erro = await coletar(enviarMensagem('oi', fetchImpl)).catch((e) => e);
    expect(erro.message).toBe(MENSAGEM_GENERICA);
  });

  it('sem sessão válida, nem chama a API', async () => {
    obterIdToken.mockRejectedValue(new Error('SESSAO_EXPIRADA'));
    const fetchImpl = vi.fn();
    const erro = await coletar(enviarMensagem('oi', fetchImpl)).catch((e) => e);
    expect(erro.message).toBe(MENSAGEM_SESSAO_EXPIRADA);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('carregarConversas', () => {
  it('GET /conversas com Bearer e devolve as mensagens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta(200, { json: { mensagens: [{ role: 'user', texto: 'oi' }] } }));
    expect(await carregarConversas(fetchImpl)).toEqual([{ role: 'user', texto: 'oi' }]);
    const [url, opcoes] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.exemplo.com/prod/conversas');
    expect(opcoes.headers.Authorization).toBe('Bearer TOKEN-DO-USUARIO');
  });

  it('401 vira sessão expirada', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resposta(401));
    await expect(carregarConversas(fetchImpl)).rejects.toThrow(MENSAGEM_SESSAO_EXPIRADA);
  });
});
