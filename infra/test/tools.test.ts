import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { stackDeTeste } from './helpers';

const stack = stackDeTeste('ToolsTestStack');
const template = Template.fromStack(stack);

test('cria as 5 funcoes Lambda (3 tools + 2 da API) em Node 22', () => {
  template.resourceCountIs('AWS::Lambda::Function', 5);
  template.allResourcesProperties('AWS::Lambda::Function', { Runtime: 'nodejs22.x' });
});

test('cada funcao tem o handler esperado', () => {
  for (const handler of ['listar-catalogo.handler', 'registrar-intencao.handler', 'realizar-compra.handler']) {
    template.hasResourceProperties('AWS::Lambda::Function', { Handler: handler });
  }
});

test('grupos de logs sao removidos no destroy', () => {
  template.resourceCountIs('AWS::Logs::LogGroup', 5);
  const grupos = template.findResources('AWS::Logs::LogGroup');
  for (const g of Object.values(grupos)) expect(g.DeletionPolicy).toBe('Delete');
});

test('nenhuma role usa politica gerenciada (nada de AWSLambdaBasicExecutionRole nem Administrator)', () => {
  const roles = template.findResources('AWS::IAM::Role');
  for (const r of Object.values(roles)) {
    expect((r as any).Properties.ManagedPolicyArns).toBeUndefined();
  }
});

test('IAM: nenhuma permissao com Action "*" ou Resource "*"', () => {
  const politicas = template.findResources('AWS::IAM::Policy');
  // a role do agente tem teste proprio em agent.test.ts (com as exceções documentadas)
  for (const [nome, p] of Object.entries(politicas).filter(([n]) => !n.includes('AgentExecutionRole'))) {
    const statements = (p as any).Properties.PolicyDocument.Statement;
    for (const s of statements) {
      const acoes = [].concat(s.Action);
      const recursos = [].concat(s.Resource);
      expect(acoes).not.toContain('*');
      expect(recursos).not.toContain('*');
      for (const a of acoes as string[]) expect(a.endsWith(':*')).toBe(false);
    }
  }
});

test('listar_catalogo nao tem nenhuma permissao de DynamoDB', () => {
  const politicas = template.findResources('AWS::IAM::Policy');
  const dePolitica = Object.entries(politicas).find(([nome]) => nome.includes('ListarCatalogoRole'));
  const acoes = ((dePolitica![1] as any).Properties.PolicyDocument.Statement as any[]).flatMap((s) => [].concat(s.Action));
  expect(acoes.some((a: string) => a.startsWith('dynamodb:'))).toBe(false);
});

test('registrar_intencao so pode gravar (PutItem) em UMA tabela', () => {
  const politicas = template.findResources('AWS::IAM::Policy');
  const [, pol] = Object.entries(politicas).find(([nome]) => nome.includes('RegistrarIntencaoRole'))!;
  const dynamo = ((pol as any).Properties.PolicyDocument.Statement as any[]).filter((s) =>
    [].concat(s.Action).some((a: string) => a.startsWith('dynamodb:')),
  );
  expect(dynamo).toHaveLength(1);
  expect(dynamo[0].Action).toEqual('dynamodb:PutItem');
});

test('realizar_compra recebe o limite padrao por variavel de ambiente', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'realizar-compra.handler',
    Environment: { Variables: Match.objectLike({ LIMITE_PADRAO: '500' }) },
  });
});
