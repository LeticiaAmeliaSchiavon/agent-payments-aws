import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { AgentPaymentsStack } from '../lib/agent-payments-stack';

export const ORIGEM_DE_TESTE = 'https://main.exemplo.amplifyapp.com';

/** Cria a stack usando uma pasta de agente de mentira, para os testes não dependerem do build real. */
export function stackDeTeste(id: string): AgentPaymentsStack {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
  fs.writeFileSync(path.join(pasta, 'main.py'), 'print("teste")\n');
  // Lista vazia = não empacota (esbuild) as Lambdas da API nos testes: ficam rápidos e sem depender de node_modules.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  return new AgentPaymentsStack(app, id, { agentCodePath: pasta, frontendOrigin: ORIGEM_DE_TESTE });
}
