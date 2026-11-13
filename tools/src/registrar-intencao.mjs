import { randomUUID } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tabelas } from './db.mjs';
import { buscarProduto } from './catalogo.mjs';
import { logarErro, MENSAGEM_ERRO_INTERNO } from './erros.mjs';

const VALIDADE_MS = 10 * 60 * 1000; // a intenção vale por 10 minutos

export async function registrarIntencao({ usuario_id, produto_id, quantidade }, { agora = new Date() } = {}) {
  if (typeof usuario_id !== 'string' || !usuario_id) {
    return { erro: 'USUARIO_INVALIDO', mensagem: 'Sessão sem usuário identificado.' };
  }

  const produto = buscarProduto(produto_id);
  if (!produto) {
    return { erro: 'PRODUTO_INVALIDO', mensagem: `Produto ${produto_id} não existe no catálogo.` };
  }

  // Modelos às vezes mandam "2" (texto) em vez de 2 (número): aceitamos os dois.
  const qtd = Number(quantidade);
  if (!Number.isInteger(qtd) || qtd <= 0) {
    return { erro: 'QUANTIDADE_INVALIDA', mensagem: 'A quantidade deve ser um número inteiro maior que zero.' };
  }
  if (qtd > produto.estoque) {
    return { erro: 'ESTOQUE_INSUFICIENTE', mensagem: `Estoque disponível: ${produto.estoque}.` };
  }

  const intencao_id = 'int_' + randomUUID().replace(/-/g, '').slice(0, 12);
  const expira_em = new Date(agora.getTime() + VALIDADE_MS).toISOString();
  // O valor é calculado AQUI, a partir do catálogo. Nunca vem do chamador.
  const valor_total = Number((produto.preco * qtd).toFixed(2));

  await ddb.send(
    new PutCommand({
      TableName: tabelas.intencoes(),
      Item: {
        intencao_id,
        usuario_id,
        produto_id,
        quantidade: qtd,
        valor_total,
        moeda: produto.moeda,
        status: 'PENDENTE',
        criada_em: agora.toISOString(),
        expira_em,
      },
      ConditionExpression: 'attribute_not_exists(intencao_id)',
    }),
  );

  return { intencao_id, produto_id, quantidade: qtd, valor_total, moeda: produto.moeda, status: 'pendente', expira_em };
}

export const handler = async (event) => {
  try {
    return await registrarIntencao(event ?? {});
  } catch (e) {
    logarErro('registrar_intencao', e);
    return { erro: 'ERRO_INTERNO', mensagem: MENSAGEM_ERRO_INTERNO };
  }
};
