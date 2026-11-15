import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Tools } from './tools';

/** Modelo do Bedrock: Claude Haiku 4.5, chamado pelo perfil de inferência "us." (roteia entre regiões dos EUA). */
export const MODELO_BASE = 'anthropic.claude-haiku-4-5-20251001-v1:0';
export const MODELO_PERFIL = `us.${MODELO_BASE}`;

export interface AgentProps {
  tools: Tools;
  /** Pasta com o código do agente + dependências arm64 (gerada por scripts/build-agent.mjs). */
  codePath: string;
}

/** O agente Strands no AgentCore Runtime, com a role de menor privilégio. */
export class Agent extends Construct {
  public readonly runtime: agentcore.Runtime;
  public readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: AgentProps) {
    super(scope, id);
    const { tools, codePath } = props;
    const stack = cdk.Stack.of(this);

    if (!fs.existsSync(path.join(codePath, 'main.py'))) {
      throw new Error(
        `Não encontrei o código do agente em "${codePath}". Rode "node scripts/build-agent.mjs" dentro da pasta infra/.`,
      );
    }

    const runtimeName = 'agent_payments';

    // Só o serviço AgentCore, e só em nome deste runtime, pode assumir esta role.
    this.role = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': stack.account },
          ArnLike: {
            'aws:SourceArn': `arn:${stack.partition}:bedrock-agentcore:${stack.region}:${stack.account}:runtime/${runtimeName}*`,
          },
        },
      }),
    });

    // O construct Runtime já acrescenta a esta role o básico que o serviço exige: logs nos grupos do
    // AgentCore, leitura do código no bucket de assets, token de identidade do workload e,
    // com "Resource": "*" porque a AWS não permite restringir por recurso, X-Ray e métricas do
    // CloudWatch (esta última limitada ao namespace bedrock-agentcore). Veja test/agent.test.ts.
    // Abaixo vem só o que é específico do nosso agente: o modelo e as 3 Lambdas.

    // Modelo: só o Haiku 4.5, e o modelo base só pode ser usado POR MEIO deste perfil de inferência.
    // São dois statements de propósito (padrão documentado da AWS): a condição
    // bedrock:InferenceProfileArn só existe quando o alvo é o modelo base. Se ela valesse também para
    // o perfil, a AWS negaria o acesso (foi o erro do primeiro deploy: AccessDenied no ConverseStream).
    const perfil = `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/${MODELO_PERFIL}`;
    const acoesDoModelo = ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'];
    this.role.addToPolicy(new iam.PolicyStatement({
      sid: 'InvokeInferenceProfile',
      actions: acoesDoModelo,
      resources: [perfil],
    }));
    this.role.addToPolicy(new iam.PolicyStatement({
      sid: 'InvokeBaseModelOnlyViaProfile',
      actions: acoesDoModelo,
      // O perfil "us." pode rotear para outra região dos EUA, por isso a região é curinga aqui.
      resources: [`arn:${stack.partition}:bedrock:*::foundation-model/${MODELO_BASE}`],
      conditions: { StringEquals: { 'bedrock:InferenceProfileArn': perfil } },
    }));

    // Ferramentas: só as 3 Lambdas deste projeto. Nenhum acesso direto às tabelas.
    tools.listarCatalogo.grantInvoke(this.role);
    tools.registrarIntencao.grantInvoke(this.role);
    tools.realizarCompra.grantInvoke(this.role);

    this.runtime = new agentcore.Runtime(this, 'Runtime', {
      runtimeName,
      description: 'Agente de compras (Strands) com ferramentas em Lambda',
      executionRole: this.role,
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromCodeAsset({
        path: codePath,
        runtime: agentcore.AgentCoreRuntime.PYTHON_3_13,
        entrypoint: ['main.py'],
      }),
      environmentVariables: {
        MODEL_ID: MODELO_PERFIL,
        FUNCAO_LISTAR_CATALOGO: tools.listarCatalogo.functionName,
        FUNCAO_REGISTRAR_INTENCAO: tools.registrarIntencao.functionName,
        FUNCAO_REALIZAR_COMPRA: tools.realizarCompra.functionName,
      },
    });
  }
}
