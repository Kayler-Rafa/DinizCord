/**
 * Sobe o Next e o gateway WebSocket juntos, em um terminal só.
 *
 * São dois processos porque são dois deploys diferentes em produção (ver
 * README > "WebSockets e Vercel"). Em desenvolvimento, porém, ninguém quer
 * gerenciar duas abas de terminal — este script cuida disso e garante que
 * encerrar um derrube o outro, evitando um gateway órfão segurando a porta 3001.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const SERVICES = [
  { name: 'next   ', args: ['run', 'dev'] },
  { name: 'gateway', args: ['run', 'gateway:dev'] },
];

const children = [];
let shuttingDown = false;

/** Prefixa cada linha com o nome do serviço, para saber quem falou. */
function prefixOutput(service, stream, target) {
  stream.setEncoding('utf8');

  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    // A última parte pode ser uma linha incompleta; guarda para o próximo chunk.
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      target.write(`[${service.name}] ${line}\n`);
    }
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }

  // Dá um instante para o encerramento limpo antes de sair.
  setTimeout(() => process.exit(code), 300);
}

for (const service of SERVICES) {
  const child = spawn(npm, service.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    // `npm` no Windows é um .cmd e precisa do shell para ser executado.
    shell: isWindows,
  });

  children.push(child);

  prefixOutput(service, child.stdout, process.stdout);
  prefixOutput(service, child.stderr, process.stderr);

  child.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`\n[dev-all] "${service.name.trim()}" saiu com codigo ${code}. Encerrando o resto.`);
    shutdown(code ?? 1);
  });

  child.on('error', (error) => {
    console.error(`[dev-all] Falha ao iniciar "${service.name.trim()}":`, error.message);
    shutdown(1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev-all] Next em http://localhost:3000 | gateway em ws://localhost:3001');
console.log('[dev-all] Ctrl+C encerra os dois.\n');
