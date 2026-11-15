import { Match, Template } from 'aws-cdk-lib/assertions';
import { stackDeTeste } from './helpers';

const template = Template.fromStack(stackDeTeste('AgentTestStack'));

/** Statements da política da role do runtime do agente. */
function statementsDoAgente(): any[] {
  const politicas = template.findResources('AWS::IAM::Policy');
  const [, politica] = Object.entries(politicas).find(([nome]) => nome.includes('AgentExecutionRole'))!;
  return (politica as any).Properties.PolicyDocument.Statement;
}
const acoesDe = (statements: any[]) => statements.flatMap((s) => ([] as string[]).concat(s.Action));

test('cria 1 runtime do AgentCore com codigo Python 3.13 e entrypoint main.py', () => {
  template.resourceCountIs('AWS::BedrockAgentCore::Runtime', 1);
  template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
    AgentRuntimeName: 'agent_payments',
    AgentRuntimeArtifact: {
      CodeConfiguration: Match.objectLike({ Runtime: 'PYTHON_3_13', EntryPoint: ['main.py'] }),
    },
  });
});

test('o runtime recebe o modelo e os nomes das 3 Lambdas por variavel de ambiente', () => {
  template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
    EnvironmentVariables: Match.objectLike({
      MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      FUNCAO_LISTAR_CATALOGO: Match.anyValue(),
      FUNCAO_REGISTRAR_INTENCAO: Match.anyValue(),
      FUNCAO_REALIZAR_COMPRA: Match.anyValue(),
    }),
  });
});

test('so o servico AgentCore, desta conta, pode assumir a role do agente', () => {
  const roles = Object.entries(template.findResources('AWS::IAM::Role'));
  const [, role] = roles.find(([nome]) => nome.includes('AgentExecutionRole'))!;
  const trust = (role as any).Properties.AssumeRolePolicyDocument.Statement[0];
  expect(trust.Principal.Service).toBe('bedrock-agentcore.amazonaws.com');
  expect(trust.Condition.StringEquals['aws:SourceAccount']).toBeDefined();
});

test('a role do agente nao usa politica gerenciada', () => {
  const roles = Object.entries(template.findResources('AWS::IAM::Role'));
  const [, role] = roles.find(([nome]) => nome.includes('AgentExecutionRole'))!;
  expect((role as any).Properties.ManagedPolicyArns).toBeUndefined();
});

test('o agente NAO tem acesso direto ao DynamoDB', () => {
  expect(acoesDe(statementsDoAgente()).filter((a) => a.startsWith('dynamodb:'))).toEqual([]);
});

test('o agente invoca exatamente as 3 Lambdas das tools, e mais nenhuma', () => {
  const invocacoes = statementsDoAgente().filter((s) => ([] as string[]).concat(s.Action).includes('lambda:InvokeFunction'));
  // cada recurso é o ARN da função ou o ARN com ":*" (versões); em ambos os casos identificamos a função pelo GetAtt
  const funcoes = new Set<string>();
  for (const recurso of invocacoes.flatMap((s) => ([] as any[]).concat(s.Resource))) {
    const getAtt = recurso['Fn::GetAtt'] ?? recurso['Fn::Join']?.[1].find((p: any) => p['Fn::GetAtt'])?.['Fn::GetAtt'];
    funcoes.add(getAtt[0]);
  }
  expect(funcoes.size).toBe(3);
});

test('o modelo so pode ser usado pelo perfil de inferencia us. do Haiku 4.5', () => {
  const modelo = statementsDoAgente().find((s) => ([] as string[]).concat(s.Action).includes('bedrock:InvokeModel'))!;
  expect(modelo.Action).toEqual(['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream']);
  expect(JSON.stringify(modelo.Resource)).toContain('claude-haiku-4-5');
  expect(modelo.Condition.StringEquals['bedrock:InferenceProfileArn']).toBeDefined();
});

test('IAM do agente: nenhum Action "*" e so 2 exceções de Resource "*", ambas exigidas pela AWS', () => {
  const statements = statementsDoAgente();
  for (const s of statements) {
    const acoes = ([] as string[]).concat(s.Action);
    expect(acoes).not.toContain('*');
    for (const a of acoes) expect(a.endsWith(':*')).toBe(false);
  }
  const comCuringa = statements.filter((s) => ([] as any[]).concat(s.Resource).includes('*'));
  // X-Ray não aceita permissão por recurso; PutMetricData fica restrito ao namespace do AgentCore.
  expect(comCuringa.map((s) => s.Sid).sort()).toEqual(['CloudWatchMetrics', 'XRayAccess']);
  const metricas = comCuringa.find((s) => s.Sid === 'CloudWatchMetrics');
  expect(metricas.Action).toBe('cloudwatch:PutMetricData');
  expect(metricas.Condition.StringEquals['cloudwatch:namespace']).toBe('bedrock-agentcore');
});

test('nao ha Sid repetido na politica do agente (o CloudFormation recusa)', () => {
  const sids = statementsDoAgente().map((s) => s.Sid).filter(Boolean);
  expect(new Set(sids).size).toBe(sids.length);
});

test('a Lambda do chat ainda nao existe: nada alem das 3 tools e do runtime foi criado por engano', () => {
  template.resourceCountIs('AWS::Lambda::Function', 3);
});
