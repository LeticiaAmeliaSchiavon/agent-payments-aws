import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { AgentPaymentsStack } from '../lib/agent-payments-stack';

const app = new cdk.App();
const stack = new AgentPaymentsStack(app, 'TestStack');
const template = Template.fromStack(stack);

test('cria as 4 tabelas do projeto', () => {
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 4);
});

test('todas as tabelas usam cobranca sob demanda e sao removidas no destroy', () => {
    const tabelas = template.findResources('AWS::DynamoDB::GlobalTable');
    for (const t of Object.values(tabelas)) {
        expect(t.Properties.BillingMode).toBe('PAY_PER_REQUEST');
        expect(t.DeletionPolicy).toBe('Delete');
    }
});

test('conversas usa usuario_id + criado_em como chave', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
        KeySchema: [
            { AttributeName: 'usuario_id', KeyType: 'HASH' },
            { AttributeName: 'criado_em', KeyType: 'RANGE' },
        ],
    });
});

test('intencoes usa intencao_id como chave', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
        KeySchema: [{ AttributeName: 'intencao_id', KeyType: 'HASH' }],
    });
});

test('transacoes tem indice por usuario', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
        GlobalSecondaryIndexes: [{ IndexName: 'por-usuario' }],
    });
});