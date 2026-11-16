#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib/core';
import { AgentPaymentsStack } from '../lib/agent-payments-stack';

// config.json guarda a URL do app no Amplify (não é segredo). Enquanto o app não existe, usa localhost.
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'));

const app = new cdk.App();

new AgentPaymentsStack(app, 'AgentPaymentsStack', {
  // Conta vem do perfil SSO ativo; a região é fixa porque o desafio
  // exige us-east-1 para todos os recursos.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  frontendOrigin: config.frontendOrigin,
});
