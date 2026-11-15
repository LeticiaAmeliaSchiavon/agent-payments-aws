import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { AgentPaymentsStack } from '../lib/agent-payments-stack';

/** Cria a stack usando uma pasta de agente de mentira, para os testes não dependerem do build real. */
export function stackDeTeste(id: string): AgentPaymentsStack {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
  fs.writeFileSync(path.join(pasta, 'main.py'), 'print("teste")\n');
  return new AgentPaymentsStack(new cdk.App(), id, { agentCodePath: pasta });
}
