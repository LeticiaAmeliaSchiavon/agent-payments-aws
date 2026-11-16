import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { Agent } from './agent';
import { Database } from './database';

export interface ApiProps {
  database: Database;
  agent: Agent;
  userPool: cognito.IUserPool;
  /** Única origem aceita pelo CORS: a URL do app no Amplify. */
  frontendOrigin: string;
}

/** API do webchat: API Gateway (REST, com streaming) + autorizador Cognito + 2 Lambdas. */
export class Api extends Construct {
  public readonly restApi: apigateway.RestApi;
  public readonly chat: nodejs.NodejsFunction;
  public readonly conversas: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id);
    const { database, agent, userPool, frontendOrigin } = props;
    const apiDir = path.join(__dirname, '../../../api');

    // Cada Lambda: grupo de logs próprio (some no destroy) e role sem política gerenciada.
    const criar = (nome: string, arquivo: string, opcoes: { timeout: cdk.Duration; memoria: number }) => {
      const logGroup = new logs.LogGroup(this, `${nome}Logs`, {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      const role = new iam.Role(this, `${nome}Role`, { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
      logGroup.grantWrite(role);

      const fn = new nodejs.NodejsFunction(this, nome, {
        entry: path.join(apiDir, 'src', arquivo),
        projectRoot: apiDir,
        depsLockFilePath: path.join(apiDir, 'package-lock.json'),
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'handler',
        role,
        logGroup,
        timeout: opcoes.timeout,
        memorySize: opcoes.memoria,
        environment: {
          CONVERSAS_TABLE: database.conversas.tableName,
          ALLOWED_ORIGIN: frontendOrigin,
          ...(nome === 'Chat' ? { AGENT_RUNTIME_ARN: agent.runtime.agentRuntimeArn } : {}),
        },
        bundling: {
          // CommonJS (o padrão): o pacote ESM do SDK quebra na inicialização com "Dynamic require is not
          // supported", a menos que se passe um `banner` com aspas e espaços, que o cmd.exe do Windows trata mal.
          minify: true,
          // Empacota o SDK junto: a versão embutida no runtime do Lambda pode não ter o client do AgentCore.
          externalModules: [],
        },
      });
      return { fn, role };
    };

    // Chat: lê e grava SÓ a tabela de conversas e invoca SÓ o runtime do agente.
    const chat = criar('Chat', 'chat.mjs', { timeout: cdk.Duration.minutes(2), memoria: 512 });
    database.conversas.grant(chat.role, 'dynamodb:Query', 'dynamodb:PutItem');
    agent.runtime.grantInvokeRuntime(chat.role);
    this.chat = chat.fn;

    // Conversas: só lê a tabela de conversas.
    const conversas = criar('Conversas', 'conversas.mjs', { timeout: cdk.Duration.seconds(15), memoria: 256 });
    database.conversas.grant(conversas.role, 'dynamodb:Query');
    this.conversas = conversas.fn;

    this.restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: 'agent-payments-api',
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      cloudWatchRole: false, // não cria a role global de logs da conta
      deployOptions: {
        stageName: 'prod',
        // Limites por segundo: protegem o custo do modelo contra abuso.
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [frontendOrigin], // só o app no Amplify, nunca "*"
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type'],
      },
    });

    // Respostas de erro do próprio API Gateway (inclui o 401) também precisam do cabeçalho de CORS,
    // senão o navegador esconde o 401 do app.
    const cabecalhoCors = { 'Access-Control-Allow-Origin': `'${frontendOrigin}'` };
    this.restApi.addGatewayResponse('Default4xx', { type: apigateway.ResponseType.DEFAULT_4XX, responseHeaders: cabecalhoCors });
    this.restApi.addGatewayResponse('Default5xx', { type: apigateway.ResponseType.DEFAULT_5XX, responseHeaders: cabecalhoCors });

    // O autorizador valida o JWT do Cognito no PRÓPRIO API Gateway: sem token válido, 401 e a Lambda nem é chamada.
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
      identitySource: 'method.request.header.Authorization',
    });
    const protegido = { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO };

    this.restApi.root.addResource('chat').addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.chat, {
        responseTransferMode: apigateway.ResponseTransferMode.STREAM, // resposta chega ao navegador aos poucos
        timeout: cdk.Duration.minutes(2),
      }),
      protegido,
    );
    this.restApi.root.addResource('conversas').addMethod('GET', new apigateway.LambdaIntegration(this.conversas), protegido);
  }
}
