export default function ConfigAusente({ variaveis }) {
  return (
    <div style={{ maxWidth: 520, margin: '80px auto', padding: 24, fontFamily: 'sans-serif', lineHeight: 1.6 }}>
      <h2>Configuração incompleta</h2>
      <p>O app não encontrou estas variáveis de ambiente:</p>
      <ul>
        {variaveis.map((nome) => (
          <li key={nome}><code>{nome}</code></li>
        ))}
      </ul>
      <p>
        Local: copie <code>.env.example</code> para <code>.env</code> e preencha com os Outputs do <code>cdk deploy</code>.
        No Amplify: defina as variáveis no console do app e faça um novo build.
      </p>
    </div>
  );
}
