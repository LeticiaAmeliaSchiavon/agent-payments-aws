import * as cdk from 'aws-cdk-lib/core';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

/** Onde o convidado encontra o passo a passo para abrir o app. */
const INSTRUCOES_URL = 'https://github.com/LeticiaAmeliaSchiavon/agent-payments-aws#readme';

/** Login: Cognito com cadastro SOMENTE por convite do administrador. */
export class Auth extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly client: cognito.UserPoolClient;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'agent-payments-users',
      // Sem auto cadastro: no CloudFormation vira AdminCreateUserConfig.AllowAdminCreateUserOnly = true.
      // Vale na API do Cognito, não só na tela: um SignUp feito direto na API é recusado.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      userInvitation: {
        emailSubject: 'Seu acesso ao Agente de Pagamentos',
        emailBody:
          'Olá! Você foi convidado(a) para usar o Agente de Pagamentos.<br/><br/>' +
          'Usuário: <b>{username}</b><br/>' +
          'Senha temporária: <b>{####}</b><br/><br/>' +
          'No primeiro acesso você vai precisar criar uma nova senha.<br/><br/>' +
          `Como abrir o app (ele roda na sua máquina): ${INSTRUCOES_URL}`,
      },
      passwordPolicy: {
        // O padrão do Cognito é 7 dias. O app fica no ar aguardando a correção, então a senha temporária
        // do convite precisa durar mais que isso.
        tempPasswordValidity: cdk.Duration.days(30),
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // o `cdk destroy` remove o user pool junto
    });

    this.client = this.userPool.addClient('WebClient', {
      generateSecret: false, // app de navegador não guarda segredo
      authFlows: {
        userSrp: true, // o que o Amplify usa: a senha nunca trafega em texto puro
        adminUserPassword: true, // só com credenciais de administrador da AWS; serve para testar pelo terminal
      },
      preventUserExistenceErrors: true,
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(1),
    });
  }
}
