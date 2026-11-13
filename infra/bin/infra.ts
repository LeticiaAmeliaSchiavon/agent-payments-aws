#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AgentPaymentsStack } from '../lib/agent-payments-stack';

const app = new cdk.App();

new AgentPaymentsStack(app, 'AgentPaymentsStack', {
  // Conta vem do perfil SSO ativo; a região é fixa porque o desafio
  // exige us-east-1 para todos os recursos.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});