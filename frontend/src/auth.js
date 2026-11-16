import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { config } from './config.js';

export function configurarAmplify() {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        // O user pool usa o e-mail como login. Sem isto, a tela mostra "Nome do usuário".
        loginWith: { email: true },
      },
    },
  });
}

/**
 * Token de identidade (ID token) do usuário logado, o que o API Gateway valida a cada requisição.
 * O Amplify renova o token sozinho enquanto o refresh token valer.
 */
export async function obterIdToken() {
  const { tokens } = await fetchAuthSession();
  const token = tokens?.idToken?.toString();
  if (!token) throw new Error('SESSAO_EXPIRADA');
  return token;
}
