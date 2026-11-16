import { useEffect, useRef, useState } from 'react';
import { carregarConversas, enviarMensagem } from './api.js';
import { formatar } from './formatar.jsx';
import ui from './styles/ui.module.css';
import styles from './Chat.module.css';

const MENSAGEM_ERRO = 'Não foi possível falar com o servidor agora. Tente novamente em instantes.';

export default function Chat({ usuario, onSair }) {
  const [mensagens, setMensagens] = useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(true);
  const [avisoHistorico, setAvisoHistorico] = useState('');
  const [entrada, setEntrada] = useState('');
  const [enviando, setEnviando] = useState(false);
  const area = useRef(null);

  // Ao abrir, busca o histórico que está no servidor (DynamoDB).
  useEffect(() => {
    let ativo = true;
    carregarConversas()
      .then((historico) => ativo && setMensagens(historico))
      .catch((erro) => ativo && setAvisoHistorico(erro.message || 'Não foi possível carregar o histórico.'))
      .finally(() => ativo && setCarregandoHistorico(false));
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    if (area.current) area.current.scrollTop = area.current.scrollHeight;
  }, [mensagens, enviando]);

  async function enviar() {
    const texto = entrada.trim();
    if (!texto || enviando) return;
    setEntrada('');
    setEnviando(true);
    // a mensagem do usuário e um balão vazio do agente, que vai enchendo conforme o texto chega
    setMensagens((atuais) => [...atuais, { role: 'user', texto }, { role: 'assistant', texto: '', pendente: true }]);
    const naUltima = (alterar) =>
      setMensagens((atuais) => atuais.map((m, i) => (i === atuais.length - 1 ? alterar(m) : m)));

    try {
      // Só a mensagem nova vai ao servidor: o histórico completo é carregado lá, não aqui.
      for await (const evento of enviarMensagem(texto)) {
        if (evento.evento === 'texto') naUltima((m) => ({ ...m, texto: m.texto + evento.texto }));
        else if (evento.evento === 'erro') naUltima((m) => ({ ...m, erro: evento.mensagem }));
      }
    } catch (erro) {
      naUltima((m) => ({ ...m, erro: erro.message || MENSAGEM_ERRO }));
    } finally {
      naUltima((m) => ({ ...m, pendente: false }));
      setEnviando(false);
    }
  }

  const email = usuario?.signInDetails?.loginId || usuario?.username || '';
  const inicial = (email[0] || 'V').toUpperCase();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={`${ui.brandLockup} ${ui.brandLockupSm}`}>
          <span className={`${ui.dot} ${ui.dotXs}`} />
          pagamentos.ai
        </div>
        <div className={styles.userInfo}>
          {email && <span>{email}</span>}
          <button className={`${ui.btn} ${ui.btnGhost}`} onClick={onSair}>Sair</button>
        </div>
      </header>

      <div className={styles.wrap}>
        <div className={styles.panelWrap}>
          {avisoHistorico && <div className={styles.aviso} role="status">{avisoHistorico}</div>}

          <div className={`${ui.panel} ${styles.scrollArea}`} ref={area} aria-live="polite">
            {carregandoHistorico && <p className={styles.emptyText}>Carregando conversa...</p>}

            {!carregandoHistorico && mensagens.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>$</div>
                <p className={styles.emptyText}>
                  Pergunte o que temos à venda, escolha um produto e finalize a compra por aqui mesmo.
                </p>
              </div>
            )}

            {mensagens.map((m, i) => {
              const doUsuario = m.role === 'user';
              return (
                <div key={i} className={`${styles.msgRow} ${doUsuario ? styles.msgRowUser : ''}`}>
                  <div className={`${ui.avatar} ${doUsuario ? ui.avatarUser : ui.avatarAgent}`}>
                    {doUsuario ? inicial : 'A'}
                  </div>
                  {m.pendente && !m.texto && !m.erro ? (
                    <div className={styles.typingDots} aria-label="O agente está digitando">
                      <span className={ui.dotBounce} />
                      <span className={ui.dotBounce} />
                      <span className={ui.dotBounce} />
                    </div>
                  ) : (
                    <div className={`${ui.bubble} ${doUsuario ? ui.bubbleUser : ui.bubbleAgent}`}>
                      {formatar(m.texto)}
                      {m.erro && <div className={styles.bubbleErro} role="alert">{m.erro}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.composer}>
            <input
              className={`${ui.input} ${ui.inputPill}`}
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && enviar()}
              placeholder="Digite sua mensagem..."
              maxLength={2000}
              disabled={enviando}
              aria-label="Mensagem"
            />
            <button
              className={`${ui.btn} ${ui.btnIcon}`}
              onClick={enviar}
              disabled={enviando || !entrada.trim()}
              aria-label="Enviar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 12L20 4L14 20L11 13L4 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
