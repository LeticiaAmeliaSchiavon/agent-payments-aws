import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn() } }));
vi.mock('aws-amplify/auth', () => ({ fetchAuthSession: vi.fn() }));
vi.mock('./config.js', () => ({ config: { userPoolId: 'us-east-1_ABC', userPoolClientId: 'client123' } }));

import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { configurarAmplify, obterIdToken } from './auth.js';

beforeEach(() => vi.clearAllMocks());

describe('configurarAmplify', () => {
  it('configura o Cognito com o e-mail como forma de login', () => {
    configurarAmplify();
    expect(Amplify.configure).toHaveBeenCalledWith({
      Auth: { Cognito: { userPoolId: 'us-east-1_ABC', userPoolClientId: 'client123', loginWith: { email: true } } },
    });
  });
});

describe('obterIdToken', () => {
  it('devolve o ID token como texto', async () => {
    fetchAuthSession.mockResolvedValue({ tokens: { idToken: { toString: () => 'jwt-do-usuario' } } });
    expect(await obterIdToken()).toBe('jwt-do-usuario');
  });

  it('sem sessão (nenhum token), falha em vez de mandar uma requisição sem credencial', async () => {
    fetchAuthSession.mockResolvedValue({ tokens: undefined });
    await expect(obterIdToken()).rejects.toThrow('SESSAO_EXPIRADA');
  });
});
