const { spawn } = require('node:child_process');
const path = require('node:path');
const loadLocalEnv = require('./load-local-env.cjs');

const projectRoot = path.join(__dirname, '..');
loadLocalEnv(projectRoot);

const child = spawn(process.execPath, [path.join(projectRoot, 'server', 'index.cjs')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { if (child.exitCode === null) child.kill(signal); });
}
child.on('error', error => { console.error('Denge API başlatılamadı:', error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });
