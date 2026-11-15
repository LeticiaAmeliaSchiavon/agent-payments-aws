#!/usr/bin/env node
// Monta agent/build: o código do agente + as dependências para Linux arm64
// (é o que o AgentCore Runtime exige no deploy direto de código, sem Docker).
// Roda sozinho antes de `cdk synth/diff/deploy` (veja "build" no cdk.json) e só refaz
// o trabalho quando o código ou as dependências mudaram.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const agente = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'agent');
const build = join(agente, 'build');
const fontes = ['main.py', 'tools.py', 'prompt.py'];
const insumos = [...fontes, 'uv.lock', 'pyproject.toml', '.python-version'];

function executar(comando, argumentos, { silenciarSaida = false } = {}) {
  const stdio = silenciarSaida ? ['ignore', 'ignore', 'inherit'] : 'inherit';
  const resultado = spawnSync(comando, argumentos, { cwd: agente, stdio });
  if (resultado.error?.code === 'ENOENT') {
    console.error(`\nNão encontrei o "${comando}". Instale o uv com: winget install --id=astral-sh.uv -e`);
    process.exit(1);
  }
  if (resultado.status !== 0) process.exit(resultado.status ?? 1);
}

const hash = createHash('sha256');
for (const arquivo of insumos) hash.update(arquivo).update(readFileSync(join(agente, arquivo)));
const assinatura = hash.digest('hex');
const arquivoAssinatura = join(build, '.assinatura');

if (existsSync(arquivoAssinatura) && readFileSync(arquivoAssinatura, 'utf8') === assinatura) {
  console.log('agent/build já está atualizado, nada a fazer.');
  process.exit(0);
}

console.log('Montando agent/build (dependências para Linux arm64)...');
const requisitos = join(tmpdir(), `agent-requirements-${process.pid}.txt`);
executar('uv', ['export', '--no-dev', '--no-hashes', '--frozen', '--no-emit-project', '-o', requisitos], {
  silenciarSaida: true, // o uv imprime o arquivo inteiro na tela, mesmo com -o
});

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });
executar('uv', [
  'pip', 'install', '--quiet', '--target', build,
  '--python-platform', 'aarch64-manylinux2014', '--python-version', '3.13',
  '--only-binary', ':all:', '-r', requisitos,
]);

for (const arquivo of fontes) cpSync(join(agente, arquivo), join(build, arquivo));
writeFileSync(arquivoAssinatura, assinatura);
rmSync(requisitos, { force: true });
console.log('agent/build pronto.');
