import { Authenticator } from '@aws-amplify/ui-react';
import ui from './styles/ui.module.css';
import styles from './TelaDeLogin.module.css';

export default function TelaDeLogin() {
  return (
    <div className={styles.shell}>
      <div className={styles.brandPanel}>
        <div className={`${ui.brandLockup} ${ui.brandLockupLg}`}>
          <span className={`${ui.dot} ${ui.dotSm}`} />
          pagamentos.ai
        </div>
        <div>
          <h1 className={styles.title}>Compre conversando. O agente cuida do resto.</h1>
          <p className={styles.subtitle}>
            Um chat que entende o que você quer comprar, confere seu limite e fecha o pagamento, com todas as
            regras de segurança no backend, não no que o modelo promete.
          </p>
        </div>
        <div className={styles.footNote}>sessão validada no servidor a cada mensagem</div>
      </div>

      <div className={styles.formSide}>
        <div className={styles.card}>
          <div className={styles.hintBox} style={{ marginTop: 0, marginBottom: 20 }}>
            <p className={styles.hintLabel}>Acesso somente por convite</p>
            <div className={styles.hintRow}>
              <span>Use o e-mail e a senha temporária que você recebeu. No primeiro acesso, o app pede uma nova senha.</span>
            </div>
          </div>
          {/* hideSignUp: a tela não oferece cadastro. A recusa de verdade está no Cognito (AllowAdminCreateUserOnly). */}
          <Authenticator hideSignUp />
        </div>
      </div>
    </div>
  );
}
