import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// O client fica fora do handler para ser reaproveitado entre invocações.
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Nomes das tabelas vêm de variáveis de ambiente definidas pela infra (CDK).
export const tabelas = {
  usuarios: () => process.env.USUARIOS_TABLE,
  intencoes: () => process.env.INTENCOES_TABLE,
  transacoes: () => process.env.TRANSACOES_TABLE,
};
