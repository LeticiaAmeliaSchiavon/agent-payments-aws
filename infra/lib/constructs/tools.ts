import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { Database } from './database';

export interface ToolsProps {
  database: Database;
  /** Limite inicial (R$) de um usuário na primeira compra. Definido aqui, nunca pelo modelo. */
  limitePadrao: number;
}

/** As 3 Lambdas das tools, cada uma com a sua role de menor privilégio. */
export class Tools extends Construct {
  public readonly listarCatalogo: lambda.Function;
  public readonly registrarIntencao: lambda.Function;
  public readonly realizarCompra: lambda.Function;

  constructor(scope: Construct, id: string, props: ToolsProps) {
    super(scope, id);
    const { database, limitePadrao } = props;

    // Sem bundling: o runtime Node 22 já traz o AWS SDK v3, então o código roda como está.
    const code = lambda.Code.fromAsset(path.join(__dirname, '../../../tools/src'));

    const criar = (nome: string, handler: string, environment: Record<string, string> = {}) => {
      // Grupo de logs criado pela stack: some junto com o `cdk destroy`.
      const logGroup = new logs.LogGroup(this, `${nome}Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      // Role sem política gerenciada: só pode escrever no PRÓPRIO grupo de logs.
      const role = new iam.Role(this, `${nome}Role`, {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      });
      logGroup.grantWrite(role);

      const fn = new lambda.Function(this, nome, {
        runtime: lambda.Runtime.NODEJS_22_X,
        handler,
        code,
        role,
        logGroup,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment,
      });
      return { fn, role };
    };

    // listar_catalogo: catálogo fixo no código, não precisa de nenhuma tabela.
    this.listarCatalogo = criar('ListarCatalogo', 'listar-catalogo.handler').fn;

    // registrar_intencao: só grava intenções.
    const registrar = criar('RegistrarIntencao', 'registrar-intencao.handler', {
      INTENCOES_TABLE: database.intencoes.tableName,
    });
    database.intencoes.grant(registrar.role, 'dynamodb:PutItem');
    this.registrarIntencao = registrar.fn;

    // realizar_compra: a transação mexe nas 3 tabelas, com as ações exatas de cada uma.
    const comprar = criar('RealizarCompra', 'realizar-compra.handler', {
      INTENCOES_TABLE: database.intencoes.tableName,
      USUARIOS_TABLE: database.usuarios.tableName,
      TRANSACOES_TABLE: database.transacoes.tableName,
      LIMITE_PADRAO: String(limitePadrao),
    });
    database.intencoes.grant(comprar.role, 'dynamodb:GetItem', 'dynamodb:UpdateItem');
    database.usuarios.grant(comprar.role, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem');
    database.transacoes.grant(comprar.role, 'dynamodb:PutItem');
    this.realizarCompra = comprar.fn;
  }
}
