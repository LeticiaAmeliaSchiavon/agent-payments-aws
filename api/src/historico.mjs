import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

/** Lê TODAS as mensagens do usuário, em ordem. Cada item guarda uma mensagem no formato do agente (Strands/Bedrock). */
export async function carregarHistorico(ddb, tabela, usuarioId) {
  const mensagens = [];
  let chave;
  do {
    const resposta = await ddb.send(
      new QueryCommand({
        TableName: tabela,
        KeyConditionExpression: 'usuario_id = :u',
        ExpressionAttributeValues: { ':u': usuarioId },
        ConsistentRead: true,
        ExclusiveStartKey: chave,
      }),
    );
    for (const item of resposta.Items ?? []) mensagens.push(JSON.parse(item.mensagem));
    chave = resposta.LastEvaluatedKey;
  } while (chave);
  return mensagens;
}

/**
 * Grava as mensagens novas de um turno de uma só vez (transação): ou entram todas, ou nenhuma.
 * A chave de ordenação é o instante do turno + a posição da mensagem, o que mantém a ordem.
 */
export async function salvarMensagens(ddb, tabela, usuarioId, mensagens, agora = new Date()) {
  const base = agora.toISOString();
  const itens = mensagens.map((mensagem, posicao) => ({
    Put: {
      TableName: tabela,
      Item: {
        usuario_id: usuarioId,
        criado_em: `${base}#${String(posicao).padStart(4, '0')}`,
        mensagem: JSON.stringify(mensagem),
      },
      ConditionExpression: 'attribute_not_exists(criado_em)',
    },
  }));
  for (let i = 0; i < itens.length; i += 100) {
    await ddb.send(new TransactWriteCommand({ TransactItems: itens.slice(i, i + 100) }));
  }
}

/**
 * Converte o histórico do agente no que a tela mostra: só o texto de quem fala.
 * Chamadas e resultados de ferramenta ficam de fora, e os balões seguidos do agente são unidos
 * (o texto de antes e o de depois de uma ferramenta formam uma resposta só, como no streaming).
 */
export function paraExibicao(mensagens) {
  const saida = [];
  for (const mensagem of mensagens) {
    const texto = (mensagem.content ?? [])
      .filter((bloco) => typeof bloco.text === 'string')
      .map((bloco) => bloco.text)
      .join('\n\n')
      .trim();
    if (!texto) continue;
    const anterior = saida[saida.length - 1];
    if (anterior && anterior.role === 'assistant' && mensagem.role === 'assistant') {
      anterior.texto += `\n\n${texto}`;
    } else {
      saida.push({ role: mensagem.role, texto });
    }
  }
  return saida;
}
