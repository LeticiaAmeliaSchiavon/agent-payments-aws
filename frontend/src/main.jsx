import React from 'react';
import ReactDOM from 'react-dom/client';
import '@aws-amplify/ui-react/styles.css';
import './styles/tokens.css';
import App from './App.jsx';
import ConfigAusente from './ConfigAusente.jsx';
import { configurarAmplify } from './auth.js';
import { variaveisFaltando } from './config.js';

const raiz = ReactDOM.createRoot(document.getElementById('root'));

if (variaveisFaltando.length > 0) {
  raiz.render(<ConfigAusente variaveis={variaveisFaltando} />);
} else {
  configurarAmplify();
  raiz.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
