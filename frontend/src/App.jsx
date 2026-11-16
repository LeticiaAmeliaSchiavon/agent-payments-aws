import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import './i18n.js';
import Chat from './Chat.jsx';
import TelaDeLogin from './TelaDeLogin.jsx';

function Conteudo() {
  const { authStatus, user, signOut } = useAuthenticator((contexto) => [contexto.authStatus, contexto.user]);
  if (authStatus === 'configuring') return null; // o Amplify ainda está lendo a sessão salva
  if (authStatus !== 'authenticated') return <TelaDeLogin />; // sem login não existe chat na tela
  return <Chat usuario={user} onSair={signOut} />;
}

export default function App() {
  return (
    <Authenticator.Provider>
      <Conteudo />
    </Authenticator.Provider>
  );
}
