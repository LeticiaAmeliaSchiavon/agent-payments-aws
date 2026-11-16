import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api.js', () => ({ carregarConversas: vi.fn(), enviarMensagem: vi.fn() }));

import { carregarConversas, enviarMensagem } from './api.js';
import Chat from './Chat.jsx';

const usuario = { signInDetails: { loginId: 'ana@exemplo.com' } };
const abrir = (props = {}) => render(<Chat usuario={usuario} onSair={() => {}} {...props} />);
const digitar = async (texto) => {
  const u = userEvent.setup();
  await u.type(screen.getByLabelText('Mensagem'), texto);
  await u.click(screen.getByLabelText('Enviar'));
  return u;
};
/** Stream de mentira que só continua quando `liberar()` é chamado. */
function fluxoControlado(...etapas) {
  const portoes = etapas.map(() => {
    let liberar;
    const espera = new Promise((r) => (liberar = r));
    return { espera, liberar };
  });
  async function* gerar() {
    for (let i = 0; i < etapas.length; i++) {
      await portoes[i].espera;
      yield* etapas[i];
    }
  }
  return { gerar, liberar: (i) => portoes[i].liberar() };
}

beforeEach(() => {
  carregarConversas.mockReset().mockResolvedValue([]);
  enviarMensagem.mockReset();
});

describe('histórico', () => {
  it('carrega o histórico do servidor ao abrir', async () => {
    carregarConversas.mockResolvedValue([
      { role: 'user', texto: 'o que tem?' },
      { role: 'assistant', texto: 'Temos mouse e teclado.' },
    ]);
    abrir();
    expect(await screen.findByText('o que tem?')).toBeInTheDocument();
    expect(screen.getByText('Temos mouse e teclado.')).toBeInTheDocument();
  });

  it('sem histórico, mostra o convite para começar', async () => {
    abrir();
    expect(await screen.findByText(/Pergunte o que temos à venda/)).toBeInTheDocument();
  });

  it('falha ao carregar o histórico avisa, mas o chat continua utilizável', async () => {
    carregarConversas.mockRejectedValue(new Error('Sua sessão expirou. Saia e entre novamente.'));
    abrir();
    expect(await screen.findByRole('status')).toHaveTextContent('Sua sessão expirou');
    expect(screen.getByLabelText('Mensagem')).toBeEnabled();
  });
});

describe('envio e streaming', () => {
  it('o texto aparece AOS POUCOS, e não de uma vez só', async () => {
    const { gerar, liberar } = fluxoControlado(
      [{ evento: 'texto', texto: 'Olá' }],
      [{ evento: 'texto', texto: ' mundo' }, { evento: 'fim' }],
    );
    enviarMensagem.mockImplementation(gerar);
    abrir();
    await digitar('oi');

    expect(screen.getByLabelText('O agente está digitando')).toBeInTheDocument(); // antes do 1º pedaço
    liberar(0);
    expect(await screen.findByText('Olá')).toBeInTheDocument();
    expect(screen.queryByText(/Olá mundo/)).not.toBeInTheDocument(); // o resto ainda não chegou
    expect(screen.getByLabelText('Mensagem')).toBeDisabled(); // enviando

    liberar(1);
    expect(await screen.findByText('Olá mundo')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Mensagem')).toBeEnabled());
  });

  it('a mensagem do usuário aparece na hora e só ela vai ao servidor', async () => {
    enviarMensagem.mockImplementation(async function* () {
      yield { evento: 'fim' };
    });
    abrir();
    await digitar('quero o mouse');
    expect(screen.getByText('quero o mouse')).toBeInTheDocument();
    expect(enviarMensagem).toHaveBeenCalledWith('quero o mouse');
  });

  it('negrito do agente vira <strong> e o resto é texto puro (sem HTML)', async () => {
    enviarMensagem.mockImplementation(async function* () {
      yield { evento: 'texto', texto: 'Total: **R$ 129,90** <b>x</b>' };
      yield { evento: 'fim' };
    });
    abrir();
    await digitar('oi');
    const negrito = await screen.findByText('R$ 129,90');
    expect(negrito.tagName).toBe('STRONG');
    expect(screen.getByText(/<b>x<\/b>/)).toBeInTheDocument(); // aparece como texto, não vira elemento
  });

  it('o botão de enviar fica desligado com a mensagem vazia', async () => {
    abrir();
    expect(await screen.findByLabelText('Enviar')).toBeDisabled();
  });
});

describe('erros', () => {
  it('erro da API (ex.: sessão expirada) aparece no balão e libera o campo', async () => {
    enviarMensagem.mockImplementation(async function* () {
      throw Object.assign(new Error('Sua sessão expirou. Saia e entre novamente.'), { status: 401 });
    });
    abrir();
    await digitar('oi');
    expect(await screen.findByRole('alert')).toHaveTextContent('Sua sessão expirou');
    expect(screen.getByLabelText('Mensagem')).toBeEnabled();
  });

  it('evento de erro do agente aparece, mantendo o texto que já tinha chegado', async () => {
    enviarMensagem.mockImplementation(async function* () {
      yield { evento: 'texto', texto: 'Vou verificar' };
      yield { evento: 'erro', mensagem: 'Não foi possível processar sua mensagem agora.' };
    });
    abrir();
    await digitar('oi');
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível processar');
    expect(screen.getByText(/Vou verificar/)).toBeInTheDocument();
  });
});

describe('sessão', () => {
  it('mostra o e-mail do usuário e o botão Sair chama onSair', async () => {
    const onSair = vi.fn();
    abrir({ onSair });
    expect(await screen.findByText('ana@exemplo.com')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sair' }));
    expect(onSair).toHaveBeenCalled();
  });
});
