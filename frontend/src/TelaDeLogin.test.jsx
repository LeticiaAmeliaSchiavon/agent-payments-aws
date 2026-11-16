import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import './i18n.js';
import TelaDeLogin from './TelaDeLogin.jsx';

// Mesma configuração do app (src/auth.js), sem depender das variáveis de ambiente.
Amplify.configure({
  Auth: { Cognito: { userPoolId: 'us-east-1_TESTE0001', userPoolClientId: 'clienteteste', loginWith: { email: true } } },
});

const abrir = () =>
  render(
    <Authenticator.Provider>
      <TelaDeLogin />
    </Authenticator.Provider>,
  );

describe('tela de login', () => {
  it('pede e-mail e senha, em português', async () => {
    abrir();
    expect(await screen.findByLabelText(/e-?mail/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument();
    // o campo antigo, em inglês, não pode reaparecer
    expect(screen.queryByPlaceholderText(/Enter your Username/i)).not.toBeInTheDocument();
  });

  it('NÃO oferece cadastro (hideSignUp): sem aba "Criar conta"', async () => {
    abrir();
    await screen.findByRole('button', { name: /entrar/i });
    expect(screen.queryByText(/criar conta|create account|cadastr/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('avisa que o acesso é somente por convite', async () => {
    abrir();
    expect(await screen.findByText(/Acesso somente por convite/i)).toBeInTheDocument();
  });
});
