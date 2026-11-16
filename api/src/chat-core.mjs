import { InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { carregarHistorico, salvarMensagens } from './historico.mjs';

export const MENSAGEM_DE_ERRO = 'Não foi possível processar sua mensagem agora. Tente novamente em instantes.';

/** Cada usuário tem a sua própria sessão no AgentCore (mínimo de 33 caracteres), nunca compartilhada. */
export function idDeSessao(usuarioId) {
  const id = `usuario-${usuarioId}`;
  return id.length >= 33 ? id : id.padEnd(33, '_');
}

/** Lê o stream SSE do agente ("data: {json}") mesmo quando um evento chega partido entre pedaços. */
export async function* lerEventosSse(corpo) {
  const decodificador = new TextDecoder('utf-8');
  let resto = '';
  const consumir = function* (final) {
    let posicao;
    while ((posicao = resto.indexOf('\n')) >= 0 || (final && resto.length > 0)) {
      const linha = (posicao >= 0 ? resto.slice(0, posicao) : resto).trim();
      resto = posicao >= 0 ? resto.slice(posicao + 1) : '';
      if (linha.startsWith('data:')) yield JSON.parse(linha.slice('data:'.length).trim());
    }
  };
  for await (const pedaco of corpo) {
    resto += typeof pedaco === 'string' ? pedaco : decodificador.decode(pedaco, { stream: true });
    yield* consumir(false);
  }
  yield* consumir(true);
}

/**
 * Um turno do chat: carrega o histórico do servidor, chama o agente, repassa o texto em streaming
 * e, só se o turno terminou bem, grava as mensagens novas.
 */
export async function processarChat({
  usuarioId, mensagem, ddb, tabelaConversas, runtimeArn, agentClient, enviar, agora = () => new Date(), log = console,
}) {
  try {
    const historico = await carregarHistorico(ddb, tabelaConversas, usuarioId);
    const resposta = await agentClient.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        runtimeSessionId: idDeSessao(usuarioId),
        contentType: 'application/json',
        payload: Buffer.from(JSON.stringify({ usuario_id: usuarioId, prompt: mensagem, historico })),
      }),
    );

    let novas = null;
    for await (const evento of lerEventosSse(resposta.response)) {
      if (evento.evento === 'texto') {
        enviar({ evento: 'texto', texto: evento.texto });
      } else if (evento.evento === 'erro') {
        enviar({ evento: 'erro', mensagem: evento.mensagem });
        return { ok: false }; // turno com erro não é gravado: o histórico não fica corrompido
      } else if (evento.evento === 'fim') {
        novas = evento.mensagens;
      }
    }
    if (!Array.isArray(novas)) throw new Error('O agente terminou sem enviar o evento final.');

    await salvarMensagens(ddb, tabelaConversas, usuarioId, novas, agora());
    enviar({ evento: 'fim' });
    return { ok: true };
  } catch (erro) {
    // O detalhe vai para o CloudWatch; o usuário só vê uma mensagem compreensível.
    log.error(JSON.stringify({ contexto: 'chat', usuarioId, erro: String(erro?.stack ?? erro) }));
    enviar({ evento: 'erro', mensagem: MENSAGEM_DE_ERRO });
    return { ok: false };
  }
}
