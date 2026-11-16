import { Match, Template } from 'aws-cdk-lib/assertions';
import { ORIGEM_DE_TESTE, stackDeTeste } from './helpers';

const template = Template.fromStack(stackDeTeste('ApiTestStack'));

const acoesDe = (statements: any[]) => statements.flatMap((s) => ([] as string[]).concat(s.Action));

function statementsDaRole(trecho: string): any[] {
  const politicas = template.findResources('AWS::IAM::Policy');
  const [, politica] = Object.entries(politicas).find(([nome]) => nome.includes(trecho))!;
  return (politica as any).Properties.PolicyDocument.Statement;
}

test('o autorizador e do tipo Cognito, le o header Authorization e usa o nosso user pool', () => {
  template.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
  template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
    Type: 'COGNITO_USER_POOLS',
    IdentitySource: 'method.request.header.Authorization',
    ProviderARNs: Match.anyValue(),
  });
});

test('TODO metodo (exceto o OPTIONS do CORS) exige o autorizador do Cognito', () => {
  const metodos = Object.values(template.findResources('AWS::ApiGateway::Method')) as any[];
  const reais = metodos.filter((m) => m.Properties.HttpMethod !== 'OPTIONS');
  expect(reais.map((m) => m.Properties.HttpMethod).sort()).toEqual(['GET', 'POST']);
  for (const m of reais) {
    expect(m.Properties.AuthorizationType).toBe('COGNITO_USER_POOLS');
    expect(m.Properties.AuthorizerId).toBeDefined();
  }
});

test('nao usa API key em lugar nenhum', () => {
  template.resourceCountIs('AWS::ApiGateway::ApiKey', 0);
  template.resourceCountIs('AWS::ApiGateway::UsagePlan', 0);
  for (const m of Object.values(template.findResources('AWS::ApiGateway::Method')) as any[]) {
    expect(m.Properties.ApiKeyRequired).not.toBe(true);
  }
});

test('as Lambdas da API usam o handler do pacote empacotado (index.handler)', () => {
  const funcoes = Object.values(template.findResources('AWS::Lambda::Function')) as any[];
  const daApi = funcoes.filter((f) => f.Properties.Environment?.Variables?.ALLOWED_ORIGIN);
  for (const f of daApi) expect(f.Properties.Handler).toBe('index.handler');
});

test('POST /chat usa resposta em streaming', () => {
  const metodos = Object.values(template.findResources('AWS::ApiGateway::Method')) as any[];
  const post = metodos.find((m) => m.Properties.HttpMethod === 'POST')!;
  expect(post.Properties.Integration.ResponseTransferMode).toBe('STREAM');
  expect(JSON.stringify(post.Properties.Integration.Uri)).toContain('response-streaming-invocations');
});

test('CORS aceita so a origem do app, nunca "*"', () => {
  const metodos = Object.values(template.findResources('AWS::ApiGateway::Method')) as any[];
  const opcoes = metodos.filter((m) => m.Properties.HttpMethod === 'OPTIONS');
  expect(opcoes.length).toBeGreaterThan(0);
  for (const m of opcoes) {
    const parametros = m.Properties.Integration.IntegrationResponses[0].ResponseParameters;
    expect(parametros['method.response.header.Access-Control-Allow-Origin']).toBe(`'${ORIGEM_DE_TESTE}'`);
  }
  expect(JSON.stringify(template.toJSON())).not.toContain("'*'");
});

test('as respostas de erro do API Gateway (401) tambem levam o cabecalho de CORS', () => {
  template.resourceCountIs('AWS::ApiGateway::GatewayResponse', 2);
  template.hasResourceProperties('AWS::ApiGateway::GatewayResponse', {
    ResponseType: 'DEFAULT_4XX',
    ResponseParameters: { 'gatewayresponse.header.Access-Control-Allow-Origin': `'${ORIGEM_DE_TESTE}'` },
  });
});

test('o stage limita a taxa de requisicoes (protege o custo do modelo)', () => {
  template.hasResourceProperties('AWS::ApiGateway::Stage', {
    StageName: 'prod',
    MethodSettings: Match.arrayWith([Match.objectLike({ ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 })]),
  });
});

test('as Lambdas da API recebem a origem permitida e as tabelas por variavel de ambiente', () => {
  const funcoes = Object.values(template.findResources('AWS::Lambda::Function')) as any[];
  const daApi = funcoes.filter((f) => f.Properties.Environment?.Variables?.ALLOWED_ORIGIN);
  expect(daApi).toHaveLength(2);
  for (const f of daApi) expect(f.Properties.Environment.Variables.ALLOWED_ORIGIN).toBe(ORIGEM_DE_TESTE);
  const chat = daApi.find((f) => f.Properties.Environment.Variables.AGENT_RUNTIME_ARN)!;
  expect(chat.Properties.Timeout).toBe(120);
});

test('IAM da Lambda do chat: so Query/PutItem em Conversas e InvokeAgentRuntime no runtime', () => {
  const statements = statementsDaRole('ApiChatRole');
  const dynamo = statements.filter((s) => acoesDe([s]).some((a) => a.startsWith('dynamodb:')));
  expect(dynamo).toHaveLength(1);
  expect(([] as string[]).concat(dynamo[0].Action).sort()).toEqual(['dynamodb:PutItem', 'dynamodb:Query']);
  expect(JSON.stringify(dynamo[0].Resource)).toContain('DatabaseConversas');
  // não toca nas tabelas de dinheiro nem no modelo
  for (const proibido of ['DatabaseIntencoes', 'DatabaseTransacoes', 'DatabaseUsuarios']) {
    expect(JSON.stringify(statements)).not.toContain(proibido);
  }
  expect(acoesDe(statements).filter((a) => a.startsWith('bedrock:'))).toEqual([]);
  expect(acoesDe(statements)).toContain('bedrock-agentcore:InvokeAgentRuntime');
});

test('IAM da Lambda de conversas: so Query em Conversas', () => {
  const acoes = acoesDe(statementsDaRole('ApiConversasRole'));
  expect(acoes.filter((a) => a.startsWith('dynamodb:'))).toEqual(['dynamodb:Query']);
  expect(acoes.filter((a) => a.startsWith('bedrock'))).toEqual([]);
});

test('IAM da API: nenhum "*" como acao nem como recurso', () => {
  for (const trecho of ['ApiChatRole', 'ApiConversasRole']) {
    for (const s of statementsDaRole(trecho)) {
      const acoes = ([] as string[]).concat(s.Action);
      expect(acoes).not.toContain('*');
      expect(([] as any[]).concat(s.Resource)).not.toContain('*');
      for (const a of acoes) expect(a.endsWith(':*')).toBe(false);
    }
  }
});
