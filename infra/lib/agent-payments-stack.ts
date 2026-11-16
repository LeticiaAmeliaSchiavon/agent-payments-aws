import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { Agent } from './constructs/agent';
import { Api } from './constructs/api';
import { Auth } from './constructs/auth';
import { Database } from './constructs/database';
import { Tools } from './constructs/tools';

export interface AgentPaymentsStackProps extends cdk.StackProps {
  /** Pasta com o agente já empacotado. Padrão: agent/build (gerada por scripts/build-agent.mjs). */
  agentCodePath?: string;
  /** Origem do app no Amplify, a única aceita pelo CORS. Vem de infra/config.json. */
  frontendOrigin?: string;
}

export class AgentPaymentsStack extends cdk.Stack {
  public readonly database: Database;
  public readonly tools: Tools;
  public readonly agent: Agent;
  public readonly auth: Auth;
  public readonly api: Api;

  constructor(scope: Construct, id: string, props?: AgentPaymentsStackProps) {
    super(scope, id, props);

    this.database = new Database(this, 'Database');
    this.tools = new Tools(this, 'Tools', { database: this.database, limitePadrao: 500 });
    this.agent = new Agent(this, 'Agent', {
      tools: this.tools,
      codePath: props?.agentCodePath ?? path.join(__dirname, '../../agent/build'),
    });
    this.auth = new Auth(this, 'Auth');
    this.api = new Api(this, 'Api', {
      database: this.database,
      agent: this.agent,
      userPool: this.auth.userPool,
      frontendOrigin: props?.frontendOrigin ?? 'http://localhost:3000',
    });

    new cdk.CfnOutput(this, 'UsuariosTableName', { value: this.database.usuarios.tableName });
    new cdk.CfnOutput(this, 'ConversasTableName', { value: this.database.conversas.tableName });
    new cdk.CfnOutput(this, 'IntencoesTableName', { value: this.database.intencoes.tableName });
    new cdk.CfnOutput(this, 'TransacoesTableName', { value: this.database.transacoes.tableName });

    new cdk.CfnOutput(this, 'ListarCatalogoFunction', { value: this.tools.listarCatalogo.functionName });
    new cdk.CfnOutput(this, 'RegistrarIntencaoFunction', { value: this.tools.registrarIntencao.functionName });
    new cdk.CfnOutput(this, 'RealizarCompraFunction', { value: this.tools.realizarCompra.functionName });

    new cdk.CfnOutput(this, 'AgentRuntimeArn', { value: this.agent.runtime.agentRuntimeArn });
    new cdk.CfnOutput(this, 'AgentRuntimeId', { value: this.agent.runtime.agentRuntimeId });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.auth.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.auth.client.userPoolClientId });
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.restApi.url });
  }
}
