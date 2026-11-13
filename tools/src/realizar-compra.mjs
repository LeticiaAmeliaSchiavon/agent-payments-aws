import { randomUUID } from 'node:crypto';
import { GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tabelas } from './db.mjs';
import { logarErro, MENSAGEM_ERRO_INTERNO } from './erros.mjs';

const recusar = (erro, mensagem) => ({ status: 'recusado', erro, mensagem });

const MSG_INTENCAO_INVALIDA =
  'Essa intenção de compra não existe ou não pertence a este usuário. Registre uma nova intenção para continuar.';

/** Devolve a recusa que se aplica à intenção, ou null se ela puder ser paga. */
function classificarIntencao(intencao, usuario_id, agora) {
  // Mesma mensagem para "não existe" e "é de outro usuário": não revelamos que o id existe.
  if (!intencao || intencao.usuario_id !== usuario_id) {
    return recusar('INTENCAO_INVALIDA', MSG_INTENCAO_INVALIDA);
  }
  if (intencao.status === 'PAGA') {
    return recusar('INTENCAO_JA_PAGA', 'Essa intenção já foi utilizada em uma compra.');
  }
  if (new Date(intencao.expira_em) < agora) {
    return recusar('INTENCAO_EXPIRADA', 'O prazo de validade dessa intenção expirou. Registre uma nova intenção.');
  }
  return null;
}

async function lerIntencao(intencao_id) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: tabelas.intencoes(), Key: { intencao_id }, ConsistentRead: true }),
  );
  return Item;
}

async function lerLimite(usuario_id) {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: tabelas.usuarios(), Key: { usuario_id }, ConsistentRead: true }),
  );
  return Item?.limite_disponivel;
}

/** Primeira compra do usuário: cria a linha com o limite padrão (definido na infra, não pelo modelo). */
async function garantirUsuario(usuario_id) {
  try {
    await ddb.send(
      new PutCommand({
        TableName: tabelas.usuarios(),
        Item: { usuario_id, limite_disponivel: Number(process.env.LIMITE_PADRAO ?? 500) },
        ConditionExpression: 'attribute_not_exists(usuario_id)',
      }),
    );
  } catch (e) {
    if (e.name !== 'ConditionalCheckFailedException') throw e; // já existia: tudo bem
  }
}

export async function realizarCompra({ usuario_id, intencao_id, metodo_pagamento }, { agora = new Date() } = {}) {
  if (typeof usuario_id !== 'string' || !usuario_id) {
    return recusar('INTENCAO_INVALIDA', 'Sessão sem usuário identificado.');
  }
  if (metodo_pagamento !== 'cartao' && metodo_pagamento !== 'pix') {
    return recusar('METODO_INVALIDO', 'O método de pagamento deve ser "cartao" ou "pix".');
  }
  if (typeof intencao_id !== 'string' || !intencao_id) {
    return recusar('INTENCAO_INVALIDA', MSG_INTENCAO_INVALIDA);
  }

  // O valor vem SEMPRE da intenção guardada no banco.
  const intencao = await lerIntencao(intencao_id);
  const recusa = classificarIntencao(intencao, usuario_id, agora);
  if (recusa) return recusa;

  await garantirUsuario(usuario_id);

  const transacao_id = 'tx_' + randomUUID().replace(/-/g, '').slice(0, 12);
  const data = agora.toISOString();
  const valor = intencao.valor_total;

  try {
    // Tudo ou nada: se QUALQUER condição falhar, nada é gravado.
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            // [0] só paga se ainda estiver pendente, for do usuário e não tiver expirado
            Update: {
              TableName: tabelas.intencoes(),
              Key: { intencao_id },
              UpdateExpression: 'SET #s = :paga, transacao_id = :tx, paga_em = :data',
              ConditionExpression: '#s = :pendente AND usuario_id = :uid AND expira_em > :agora',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':paga': 'PAGA', ':pendente': 'PENDENTE', ':tx': transacao_id,
                ':data': data, ':uid': usuario_id, ':agora': data,
              },
            },
          },
          {
            // [1] só desconta se o limite disponível cobrir o valor
            Update: {
              TableName: tabelas.usuarios(),
              Key: { usuario_id },
              UpdateExpression: 'SET limite_disponivel = limite_disponivel - :valor',
              ConditionExpression: 'limite_disponivel >= :valor',
              ExpressionAttributeValues: { ':valor': valor },
            },
          },
          {
            // [2] registra a transação
            Put: {
              TableName: tabelas.transacoes(),
              Item: { transacao_id, usuario_id, intencao_id, valor, metodo_pagamento, data },
              ConditionExpression: 'attribute_not_exists(transacao_id)',
            },
          },
        ],
      }),
    );
  } catch (e) {
    if (e.name === 'TransactionCanceledException') {
      const motivos = e.CancellationReasons ?? [];
      if (motivos[0]?.Code === 'ConditionalCheckFailed') {
        // Alguém pagou/expirou entre a leitura e a escrita: relê para dar o motivo certo.
        const atual = classificarIntencao(await lerIntencao(intencao_id), usuario_id, agora);
        return atual ?? recusar('INTENCAO_JA_PAGA', 'Essa intenção já foi utilizada em uma compra.');
      }
      if (motivos[1]?.Code === 'ConditionalCheckFailed') {
        const disponivel = (await lerLimite(usuario_id)) ?? 0;
        return recusar(
          'LIMITE_EXCEDIDO',
          `Essa compra de R$ ${valor.toFixed(2)} excede seu limite disponível de R$ ${Number(disponivel).toFixed(2)}.`,
        );
      }
    }
    throw e;
  }

  const limite_restante = Number((await lerLimite(usuario_id)) ?? 0);
  return { status: 'aprovado', transacao_id, intencao_id, valor, metodo_pagamento, limite_restante, data };
}

export const handler = async (event) => {
  try {
    return await realizarCompra(event ?? {});
  } catch (e) {
    logarErro('realizar_compra', e);
    return recusar('ERRO_INTERNO', MENSAGEM_ERRO_INTERNO);
  }
};
