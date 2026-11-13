import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

process.env.USUARIOS_TABLE = 'Usuarios';
process.env.INTENCOES_TABLE = 'Intencoes';
process.env.TRANSACOES_TABLE = 'Transacoes';
process.env.LIMITE_PADRAO = '500';

const { listarCatalogo } = await import('../src/listar-catalogo.mjs');
const { registrarIntencao } = await import('../src/registrar-intencao.mjs');
const { realizarCompra } = await import('../src/realizar-compra.mjs');

const ddbMock = mockClient(DynamoDBDocumentClient);
const AGORA = new Date('2026-11-13T12:00:00.000Z');
const FUTURO = '2026-11-13T12:10:00.000Z';
const PASSADO = '2026-11-13T11:00:00.000Z';

const intencao = (extra = {}) => ({
  intencao_id: 'int_abc', usuario_id: 'user-1', produto_id: 'prod_003',
  quantidade: 1, valor_total: 249.9, status: 'PENDENTE', expira_em: FUTURO, ...extra,
});
const erroTransacao = (...codes) => Object.assign(new Error('cancelada'), {
  name: 'TransactionCanceledException',
  CancellationReasons: codes.map((Code) => ({ Code })),
});

beforeEach(() => ddbMock.reset());

// ---------- listar_catalogo ----------
test('listar_catalogo: devolve todos os produtos sem filtro', () => {
  assert.equal(listarCatalogo({}).produtos.length, 5);
});
test('listar_catalogo: categoria vazia ("") conta como sem filtro', () => {
  assert.equal(listarCatalogo({ categoria: '' }).produtos.length, 5);
});
test('listar_catalogo: filtra por categoria', () => {
  const { produtos } = listarCatalogo({ categoria: 'audio' });
  assert.deepEqual(produtos.map((p) => p.id), ['prod_003']);
});
test('listar_catalogo: nao expoe a categoria no retorno (contrato)', () => {
  assert.equal('categoria' in listarCatalogo({}).produtos[0], false);
});

// ---------- registrar_intencao ----------
test('registrar_intencao: calcula o valor no backend e grava com o usuario do evento', async () => {
  ddbMock.on(PutCommand).resolves({});
  const r = await registrarIntencao(
    { usuario_id: 'user-1', produto_id: 'prod_003', quantidade: 2, valor_total: 1 },
    { agora: AGORA },
  );
  assert.match(r.intencao_id, /^int_[0-9a-f]{12}$/);
  assert.equal(r.valor_total, 499.8); // 2 x 249.90, ignorando o valor_total=1 enviado
  assert.equal(r.status, 'pendente');
  assert.equal(r.expira_em, FUTURO);
  const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item;
  assert.equal(item.usuario_id, 'user-1');
  assert.equal(item.status, 'PENDENTE');
});
test('registrar_intencao: aceita quantidade como texto ("2")', async () => {
  ddbMock.on(PutCommand).resolves({});
  const r = await registrarIntencao({ usuario_id: 'u', produto_id: 'prod_001', quantidade: '2' });
  assert.equal(r.quantidade, 2);
});
test('registrar_intencao: produto inexistente', async () => {
  const r = await registrarIntencao({ usuario_id: 'u', produto_id: 'prod_999', quantidade: 1 });
  assert.equal(r.erro, 'PRODUTO_INVALIDO');
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});
test('registrar_intencao: quantidade invalida (0, negativa, decimal, texto)', async () => {
  for (const q of [0, -1, 1.5, 'abc']) {
    const r = await registrarIntencao({ usuario_id: 'u', produto_id: 'prod_001', quantidade: q });
    assert.equal(r.erro, 'QUANTIDADE_INVALIDA', `quantidade ${q}`);
  }
});
test('registrar_intencao: acima do estoque', async () => {
  const r = await registrarIntencao({ usuario_id: 'u', produto_id: 'prod_004', quantidade: 6 });
  assert.equal(r.erro, 'ESTOQUE_INSUFICIENTE');
});
test('registrar_intencao: sem usuario no evento nao grava nada', async () => {
  const r = await registrarIntencao({ produto_id: 'prod_001', quantidade: 1 });
  assert.equal(r.erro, 'USUARIO_INVALIDO');
  assert.equal(ddbMock.commandCalls(PutCommand).length, 0);
});

// ---------- realizar_compra: recusas ----------
test('realizar_compra: metodo de pagamento invalido', async () => {
  const r = await realizarCompra({ usuario_id: 'user-1', intencao_id: 'int_abc', metodo_pagamento: 'boleto' }, { agora: AGORA });
  assert.equal(r.erro, 'METODO_INVALIDO');
});
test('realizar_compra: intencao inventada pelo modelo -> INTENCAO_INVALIDA', async () => {
  ddbMock.on(GetCommand).resolves({}); // nao existe
  const r = await realizarCompra({ usuario_id: 'user-1', intencao_id: 'int_falsa', metodo_pagamento: 'pix' }, { agora: AGORA });
  assert.equal(r.status, 'recusado');
  assert.equal(r.erro, 'INTENCAO_INVALIDA');
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
});
test('realizar_compra: intencao de OUTRO usuario -> INTENCAO_INVALIDA (mesma mensagem de inexistente)', async () => {
  ddbMock.on(GetCommand).resolves({ Item: intencao({ usuario_id: 'outro-usuario' }) });
  const r = await realizarCompra({ usuario_id: 'user-1', intencao_id: 'int_abc', metodo_pagamento: 'pix' }, { agora: AGORA });
  assert.equal(r.erro, 'INTENCAO_INVALIDA');
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
});
test('realizar_compra: intencao ja paga -> INTENCAO_JA_PAGA', async () => {
  ddbMock.on(GetCommand).resolves({ Item: intencao({ status: 'PAGA' }) });
  const r = await realizarCompra({ usuario_id: 'user-1', intencao_id: 'int_abc', metodo_pagamento: 'pix' }, { agora: AGORA });
  assert.equal(r.erro, 'INTENCAO_JA_PAGA');
});
test('realizar_compra: intencao vencida -> INTENCAO_EXPIRADA', async () => {
  ddbMock.on(GetCommand).resolves({ Item: intencao({ expira_em: PASSADO }) });
  const r = await realizarCompra({ usuario_id: 'user-1', intencao_id: 'int_abc', metodo_pagamento: 'pix' }, { agora: AGORA });
  assert.equal(r.erro, 'INTENCAO_EXPIRADA');
});

// ---------- realizar_compra: sucesso e concorrencia ----------
test('realizar_compra: aprova com pix e com cartao, usando o valor da intencao salva', async () => {
  for (const metodo of ['pix', 'cartao']) {
    ddbMock.reset();
    ddbMock.on(GetCommand, { TableName: 'Intencoes' }).resolves({ Item: intencao() });
    ddbMock.on(GetCommand, { TableName: 'Usuarios' }).resolves({ Item: { limite_disponivel: 250.1 } });
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(TransactWriteCommand).resolves({});
    const r = await realizarCompra(
      { usuario_id: 'user-1', intencao_id: 'int_abc', metodo_pagamento: metodo, valor: 0.01 },
      { agora: AGORA },
    );
    assert.equal(r.status, 'aprovado');
    assert.equal(r.valor, 249.9); // ignora o valor=0.01 enviado
    assert.equal(r.metodo_pagamento, metodo);
    assert.match(r.transacao_id, /^tx_/);
    assert.equal(r.limite_restante, 250.1);
  }
});
test('realizar_compra: a transacao tem as 3 escritas condicionais', async () => {
  ddbMock.on(GetCommand, { TableName: 'Intencoes' }).resolves({ Item: intencao() });
  ddbMock.on(GetCommand, { TableName: 'Usuarios' }).resolves({ Item: { limite_disponivel: 10 } });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(TransactWriteCommand).resolves({});
  await realizarCompra({ usuario_id: 'user-1', intencao_id: 'int_abc', metodo_pagamento: 'pix' }, { agora: AGORA });
  const itens = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
  assert.equal(itens.length, 3);
  assert.match(itens[0].Update.ConditionExpression, /#s = :pendente/);
  assert.match(itens[1].Update.ConditionExpression, /limite_disponivel >= :valor/);
  assert.match(itens[2].Put.ConditionExpression, /attribute_not_exists/);
});
test('realizar_compra: limite insuficiente -> LIMITE_EXCEDIDO', async () => {
  ddbMock.on(GetCommand, { TableName: 'Intencoes' }).resolves({ Item: intencao({ valor_total: 1199.9 }) });
  ddbMock.on(GetCommand, { TableName: 'Usuarios' }).resolves({ Item: { limite_disponivel: 250.1 } });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(TransactWriteCommand).rejects(erroTransacao('None', 'ConditionalCheckFailed', 'None'));
  const r = await realizarCompra({ usuario_id: 'user-1', intencao_id: 'int_abc', metodo_pagamento: 'cartao' }, { agora: AGORA });
  assert.equal(r.erro, 'LIMITE_EXCEDIDO');
  assert.match(r.mensagem, /250\.10/);
});
test('realizar_compra: mesma chamada duas vezes nao duplica (a 2a vira INTENCAO_JA_PAGA)', async () => {
  ddbMock.on(GetCommand, { TableName: 'Intencoes' })
    .resolvesOnce({ Item: intencao() })                 // 1a leitura: ainda pendente
    .resolves({ Item: intencao({ status: 'PAGA' }) });  // releitura: outra chamada ja pagou
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(TransactWriteCommand).rejects(erroTransacao('ConditionalCheckFailed', 'None', 'None'));
  const r = await realizarCompra({ usuario_id: 'user-1', intencao_id: 'int_abc', metodo_pagamento: 'pix' }, { agora: AGORA });
  assert.equal(r.erro, 'INTENCAO_JA_PAGA');
});
test('realizar_compra: primeira compra cria o usuario com o limite padrao', async () => {
  ddbMock.on(GetCommand, { TableName: 'Intencoes' }).resolves({ Item: intencao() });
  ddbMock.on(GetCommand, { TableName: 'Usuarios' }).resolves({ Item: { limite_disponivel: 250.1 } });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(TransactWriteCommand).resolves({});
  await realizarCompra({ usuario_id: 'user-1', intencao_id: 'int_abc', metodo_pagamento: 'pix' }, { agora: AGORA });
  const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
  assert.equal(put.TableName, 'Usuarios');
  assert.equal(put.Item.limite_disponivel, 500);
  assert.match(put.ConditionExpression, /attribute_not_exists/);
});
