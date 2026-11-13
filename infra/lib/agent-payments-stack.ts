import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { Database } from './constructs/database';

export class AgentPaymentsStack extends cdk.Stack {
  public readonly database: Database;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.database = new Database(this, 'Database');

    new cdk.CfnOutput(this, 'UsuariosTableName', { value: this.database.usuarios.tableName });
    new cdk.CfnOutput(this, 'ConversasTableName', { value: this.database.conversas.tableName });
    new cdk.CfnOutput(this, 'IntencoesTableName', { value: this.database.intencoes.tableName });
    new cdk.CfnOutput(this, 'TransacoesTableName', { value: this.database.transacoes.tableName });
  }
}