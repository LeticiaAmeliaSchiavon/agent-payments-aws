import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import { processarChat, idDeSessao, lerEventosSse, MENSAGEM_DE_ERRO } from '../src/chat-core.mjs';
import { paraExibicao } from '../src/historico.mjs';
import { cabecalhosCors, extrairUsuarioId, lerMensagem } from '../src/http.mjs';
import { listarConversas } from '../src/conversas.mjs';

const ddbMock = mockClient(DynamoDBDocumentClient);
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })); // o mock intercepta o send
const TABELA = 'Conversas';
const ARN = 'arn:aws:bedrock-agentcore:us-east-1:111111111111:runtime/agent_payments-XYZ';
const AGORA = new Date('2026-11-15T12:00:00.000Z');
const SUB = 'a1b2c3d4-0000-4000-8000-123456789abc';

beforeEach(() => ddbMock.reset());

const sse = (...eventos) => eventos.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
async function* pedacos(...partes) { for (const p of partes) yield Buffer.from(p); }
const logSilencioso = { error: () => {} };

/** Cliente de mentira do AgentCore: guarda o comando recebido e devolve o corpo combinado. */
function agenteFalso(corpo) {
  return {
    comandos: [],
    async send(comando) { this.comandos.push(comando.input); return { response: corpo }; },
  };
}
function base(extra = {}) {
  const enviados = [];
  return { enviados, args: { usuarioId: SUB, mensagem: 'oi', ddb, tabelaConversas: TABELA, runtimeArn: ARN,
    enviar: (e) => enviados.push(e), agora: () => AGORA, log: logSilencioso, ...extra } };
}
const msg = (role, text) => ({ role, content: [{ text }] });

// ---------- usuario, validacao e CORS ----------
test('usuario vem so das claims do token (sub), nunca do corpo', () => {
  const evento = {
    requestContext: { authorizer: { claims: { sub: SUB } } },
    body: JSON.stringify({ mensagem: 'oi', usuario_id: 'outro-usuario', sub: 'hacker' }),
  };
  assert.equal(extrairUsuarioId(evento), SUB);
  assert.equal(lerMensagem(evento).mensagem, 'oi');
});
test('sem claims no evento nao ha usuario (a Lambda responde 401)', () => {
  assert.equal(extrairUsuarioId({ body: '{"usuario_id":"x"}' }), null);
  assert.equal(extrairUsuarioId({ requestContext: { authorizer: { claims: {} } } }), null);
});
test('lerMensagem: valida corpo, vazio, tamanho e base64', () => {
  assert.match(lerMensagem({ body: 'nao-e-json' }).erro, /inválido/);
  assert.ok(lerMensagem({ body: '{"mensagem":"   "}' }).erro);
  assert.ok(lerMensagem({ body: '{"mensagem":123}' }).erro);
  assert.match(lerMensagem({ body: JSON.stringify({ mensagem: 'a'.repeat(2001) }) }).erro, /muito longa/);
  const b64 = Buffer.from('{"mensagem":"olá"}').toString('base64');
  assert.equal(lerMensagem({ body: b64, isBase64Encoded: true }).mensagem, 'olá');
});
test('CORS: so a origem do app recebe o cabecalho', () => {
  const permitida = 'https://main.exemplo.amplifyapp.com';
  assert.equal(cabecalhosCors({ headers: { origin: permitida } }, permitida)['Access-Control-Allow-Origin'], permitida);
  assert.equal('Access-Control-Allow-Origin' in cabecalhosCors({ headers: { origin: 'https://malicioso.com' } }, permitida), false);
  assert.equal('Access-Control-Allow-Origin' in cabecalhosCors({ headers: {} }, permitida), false);
});

// ---------- stream SSE ----------
test('lerEventosSse junta um evento partido entre pedacos', async () => {
  const texto = sse({ evento: 'texto', texto: 'Olá, mundo' }, { evento: 'fim', mensagens: [] });
  const corte = 17; // corta no meio do primeiro JSON
  const lidos = [];
  for await (const e of lerEventosSse(pedacos(texto.slice(0, corte), texto.slice(corte)))) lidos.push(e);
  assert.deepEqual(lidos.map((e) => e.evento), ['texto', 'fim']);
  assert.equal(lidos[0].texto, 'Olá, mundo');
});
test('lerEventosSse nao quebra um caractere acentuado partido entre pedacos', async () => {
  const bytes = Buffer.from(sse({ evento: 'texto', texto: 'ação' }));
  const meio = bytes.indexOf(0xc3) + 1; // entre os dois bytes de "ç"
  const lidos = [];
  async function* partido() { yield bytes.subarray(0, meio); yield bytes.subarray(meio); }
  for await (const e of lerEventosSse(partido())) lidos.push(e);
  assert.equal(lidos[0].texto, 'ação');
});
test('idDeSessao tem no minimo 33 caracteres e e unico por usuario', () => {
  assert.ok(idDeSessao(SUB).length >= 33);
  assert.ok(idDeSessao('x').length >= 33);
  assert.notEqual(idDeSessao('a'), idDeSessao('b'));
});

// ---------- turno do chat ----------
test('chat: carrega o historico do servidor, chama o agente com o usuario do token e grava o turno', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ mensagem: JSON.stringify(msg('user', 'antes')) }, { mensagem: JSON.stringify(msg('assistant', 'resposta antes')) }] });
  ddbMock.on(TransactWriteCommand).resolves({});
  const novas = [msg('user', 'oi'), msg('assistant', 'Olá!')];
  const agente = agenteFalso(pedacos(sse({ evento: 'texto', texto: 'Olá!' }, { evento: 'fim', mensagens: novas })));
  const { args, enviados } = base({ agentClient: agente });

  const r = await processarChat(args);
  assert.equal(r.ok, true);

  const entrada = agente.comandos[0];
  assert.equal(entrada.agentRuntimeArn, ARN);
  assert.ok(entrada.runtimeSessionId.length >= 33);
  const payload = JSON.parse(entrada.payload.toString());
  assert.equal(payload.usuario_id, SUB);
  assert.equal(payload.prompt, 'oi');
  assert.equal(payload.historico.length, 2); // histórico completo, vindo do banco

  assert.deepEqual(enviados, [{ evento: 'texto', texto: 'Olá!' }, { evento: 'fim' }]);
  const itens = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems;
  assert.equal(itens.length, 2);
  assert.equal(itens[0].Put.Item.usuario_id, SUB);
  assert.ok(itens[0].Put.Item.criado_em < itens[1].Put.Item.criado_em); // ordem preservada
  assert.deepEqual(JSON.parse(itens[1].Put.Item.mensagem), novas[1]);
});
test('chat: o historico do cliente nao existe, so o do servidor conta', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(TransactWriteCommand).resolves({});
  const agente = agenteFalso(pedacos(sse({ evento: 'fim', mensagens: [msg('user', 'oi')] })));
  const { args } = base({ agentClient: agente, historico: [msg('assistant', 'FORJADO pelo cliente')] });
  await processarChat(args);
  assert.deepEqual(JSON.parse(agente.comandos[0].payload.toString()).historico, []);
});
test('chat: le todas as paginas do historico', async () => {
  ddbMock.on(QueryCommand)
    .resolvesOnce({ Items: [{ mensagem: JSON.stringify(msg('user', '1')) }], LastEvaluatedKey: { usuario_id: SUB, criado_em: 'x' } })
    .resolves({ Items: [{ mensagem: JSON.stringify(msg('assistant', '2')) }] });
  ddbMock.on(TransactWriteCommand).resolves({});
  const agente = agenteFalso(pedacos(sse({ evento: 'fim', mensagens: [] })));
  await processarChat(base({ agentClient: agente }).args);
  assert.equal(JSON.parse(agente.comandos[0].payload.toString()).historico.length, 2);
});
test('chat: evento de erro do agente e repassado e NADA e gravado', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const { args, enviados } = base({ agentClient: agenteFalso(pedacos(sse({ evento: 'erro', mensagem: 'Algo deu errado.' }))) });
  assert.equal((await processarChat(args)).ok, false);
  assert.deepEqual(enviados, [{ evento: 'erro', mensagem: 'Algo deu errado.' }]);
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
});
test('chat: falha ao chamar o agente vira mensagem amigavel, sem stack trace, e nada e gravado', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const quebrado = { async send() { throw new Error('AccessDenied segredo-interno'); } };
  const { args, enviados } = base({ agentClient: quebrado });
  assert.equal((await processarChat(args)).ok, false);
  assert.deepEqual(enviados, [{ evento: 'erro', mensagem: MENSAGEM_DE_ERRO }]);
  assert.ok(!JSON.stringify(enviados).includes('segredo-interno'));
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
});
test('chat: stream que termina sem evento final e tratado como erro e nao grava', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  const { args, enviados } = base({ agentClient: agenteFalso(pedacos(sse({ evento: 'texto', texto: 'meio' }))) });
  assert.equal((await processarChat(args)).ok, false);
  assert.equal(enviados.at(-1).evento, 'erro');
  assert.equal(ddbMock.commandCalls(TransactWriteCommand).length, 0);
});

// ---------- historico para a tela ----------
test('paraExibicao: esconde ferramentas e une os baloes seguidos do agente', () => {
  const historico = [
    msg('user', 'pago no pix'),
    { role: 'assistant', content: [{ text: 'Vou finalizar.' }, { toolUse: { name: 'realizar_compra', input: {} } }] },
    { role: 'user', content: [{ toolResult: { content: [{ text: '{"status":"aprovado"}' }] } }] },
    msg('assistant', 'Compra aprovada!'),
  ];
  assert.deepEqual(paraExibicao(historico), [
    { role: 'user', texto: 'pago no pix' },
    { role: 'assistant', texto: 'Vou finalizar.\n\nCompra aprovada!' },
  ]);
});
test('GET /conversas: devolve so o historico do usuario do token', async () => {
  ddbMock.on(QueryCommand).resolves({ Items: [{ mensagem: JSON.stringify(msg('user', 'oi')) }] });
  const r = await listarConversas({ requestContext: { authorizer: { claims: { sub: SUB } } } }, { ddb, tabela: TABELA, log: logSilencioso });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body).mensagens, [{ role: 'user', texto: 'oi' }]);
  assert.equal(ddbMock.commandCalls(QueryCommand)[0].args[0].input.ExpressionAttributeValues[':u'], SUB);
});
test('GET /conversas: sem usuario no token responde 401 e nao consulta o banco', async () => {
  const r = await listarConversas({}, { ddb, tabela: TABELA, log: logSilencioso });
  assert.equal(r.statusCode, 401);
  assert.equal(ddbMock.commandCalls(QueryCommand).length, 0);
});
test('GET /conversas: falha no banco devolve 500 com mensagem amigavel', async () => {
  ddbMock.on(QueryCommand).rejects(new Error('detalhe interno'));
  const r = await listarConversas({ requestContext: { authorizer: { claims: { sub: SUB } } } }, { ddb, tabela: TABELA, log: logSilencioso });
  assert.equal(r.statusCode, 500);
  assert.ok(!r.body.includes('detalhe interno'));
});
