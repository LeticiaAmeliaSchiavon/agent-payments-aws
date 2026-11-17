import { Match, Template } from 'aws-cdk-lib/assertions';
import { stackDeTeste } from './helpers';

const template = Template.fromStack(stackDeTeste('AuthTestStack'));

test('cadastro somente por convite: AllowAdminCreateUserOnly = true', () => {
  template.hasResourceProperties('AWS::Cognito::UserPool', {
    AdminCreateUserConfig: Match.objectLike({ AllowAdminCreateUserOnly: true }),
  });
});

test('o e-mail de convite traz usuario e senha temporaria', () => {
  template.hasResourceProperties('AWS::Cognito::UserPool', {
    AdminCreateUserConfig: {
      AllowAdminCreateUserOnly: true,
      InviteMessageTemplate: Match.objectLike({
        EmailSubject: Match.stringLikeRegexp('Agente de Pagamentos'),
        EmailMessage: Match.stringLikeRegexp('\\{username\\}.*\\{####\\}'),
      }),
    },
  });
});

test('a senha temporaria do convite vale 30 dias (o padrao de 7 vence antes da correcao)', () => {
  template.hasResourceProperties('AWS::Cognito::UserPool', {
    Policies: { PasswordPolicy: Match.objectLike({ TemporaryPasswordValidityDays: 30 }) },
  });
});

test('o convite diz onde estao as instrucoes para abrir o app', () => {
  template.hasResourceProperties('AWS::Cognito::UserPool', {
    AdminCreateUserConfig: {
      AllowAdminCreateUserOnly: true,
      InviteMessageTemplate: Match.objectLike({ EmailMessage: Match.stringLikeRegexp('github\\.com/.+#readme') }),
    },
  });
});

test('o login e por e-mail e o user pool e removido no destroy', () => {
  template.hasResourceProperties('AWS::Cognito::UserPool', { UsernameAttributes: ['email'] });
  const [pool] = Object.values(template.findResources('AWS::Cognito::UserPool'));
  expect(pool.DeletionPolicy).toBe('Delete');
});

test('o app client nao tem segredo e nao permite login por senha em texto', () => {
  template.hasResourceProperties('AWS::Cognito::UserPoolClient', { GenerateSecret: false });
  const [client] = Object.values(template.findResources('AWS::Cognito::UserPoolClient'));
  const fluxos: string[] = (client as any).Properties.ExplicitAuthFlows;
  expect(fluxos).toContain('ALLOW_USER_SRP_AUTH');
  expect(fluxos).not.toContain('ALLOW_USER_PASSWORD_AUTH');
});
