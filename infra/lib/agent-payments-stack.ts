import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { Database } from './constructs/database';
import { Tools } from './constructs/tools';

export class AgentPaymentsStack extends cdk.Stack {
  public readonly database: Database;
  public readonly tools: Tools;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.database = new Database(this, 'Database');
    this.tools = new Tools(this, 'Tools', { database: this.database, limitePadrao: 500 });

    new cdk.CfnOutput(this, 'UsuariosTableName', { value: this.database.usuarios.tableName });
    new cdk.CfnOutput(this, 'ConversasTableName', { value: this.database.conversas.tableName });
    new cdk.CfnOutput(this, 'IntencoesTableName', { value: this.database.intencoes.tableName });
    new cdk.CfnOutput(this, 'TransacoesTableName', { value: this.database.transacoes.tableName });

    new cdk.CfnOutput(this, 'ListarCatalogoFunction', { value: this.tools.listarCatalogo.functionName });
    new cdk.CfnOutput(this, 'RegistrarIntencaoFunction', { value: this.tools.registrarIntencao.functionName });
    new cdk.CfnOutput(this, 'RealizarCompraFunction', { value: this.tools.realizarCompra.functionName });
  }
}
