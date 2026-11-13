import * as cdk from 'aws-cdk-lib/core';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * As 4 tabelas do projeto. Todo o estado que na Fase 1 ficava em memória
 * (Map) vive aqui, porque Lambdas são efêmeras e podem rodar em paralelo.
 */
export class Database extends Construct {
    /** Limite de gasto disponível de cada usuário. PK = sub do Cognito. */
    public readonly usuarios: dynamodb.TableV2;
    /** Histórico de mensagens. PK = usuário, SK = momento da mensagem. */
    public readonly conversas: dynamodb.TableV2;
    /** Intenções de compra registradas pelo backend. */
    public readonly intencoes: dynamodb.TableV2;
    /** Compras realizadas. */
    public readonly transacoes: dynamodb.TableV2;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        // DESTROY: sem isso o `cdk destroy` deixaria as tabelas para trás
        // e o desafio exige remover todos os recursos ao final.
        const removalPolicy = cdk.RemovalPolicy.DESTROY;

        this.usuarios = new dynamodb.TableV2(this, 'Usuarios', {
            partitionKey: { name: 'usuario_id', type: dynamodb.AttributeType.STRING },
            removalPolicy,
        });

        this.conversas = new dynamodb.TableV2(this, 'Conversas', {
            partitionKey: { name: 'usuario_id', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'criado_em', type: dynamodb.AttributeType.STRING },
            removalPolicy,
        });

        this.intencoes = new dynamodb.TableV2(this, 'Intencoes', {
            partitionKey: { name: 'intencao_id', type: dynamodb.AttributeType.STRING },
            removalPolicy,
        });

        this.transacoes = new dynamodb.TableV2(this, 'Transacoes', {
            partitionKey: { name: 'transacao_id', type: dynamodb.AttributeType.STRING },
            globalSecondaryIndexes: [
                {
                    // permite listar as compras de um usuário em ordem de data
                    indexName: 'por-usuario',
                    partitionKey: { name: 'usuario_id', type: dynamodb.AttributeType.STRING },
                    sortKey: { name: 'data', type: dynamodb.AttributeType.STRING },
                },
            ],
            removalPolicy,
        });
    }
}