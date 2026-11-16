const NOMES = {
  userPoolId: 'VITE_USER_POOL_ID',
  userPoolClientId: 'VITE_USER_POOL_CLIENT_ID',
  apiUrl: 'VITE_API_URL',
};

const valores = {
  userPoolId: import.meta.env.VITE_USER_POOL_ID,
  userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
  apiUrl: import.meta.env.VITE_API_URL,
};

/** Variáveis de ambiente que não foram definidas (para mostrar um aviso claro em vez de uma tela em branco). */
export const variaveisFaltando = Object.entries(valores)
  .filter(([, valor]) => !valor)
  .map(([chave]) => NOMES[chave]);

export const config = {
  userPoolId: valores.userPoolId,
  userPoolClientId: valores.userPoolClientId,
  // sem barra no final, para montar "<apiUrl>/chat" sem barra dupla
  apiUrl: (valores.apiUrl ?? '').replace(/\/+$/, ''),
};
