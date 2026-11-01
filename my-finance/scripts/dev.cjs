const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const angularCli = require.resolve('@angular/cli/bin/ng.js', { paths: [projectRoot] });
const children = [];
let stopping = false;

function portIsAvailable(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    const onListen = () => server.close(() => resolve(true));
    if (host) server.listen(port, host, onListen);
    else server.listen(port, onListen);
  });
}

function spawnChild(args, name) {
  const child = spawn(process.execPath, args, { cwd: projectRoot, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('error', (error) => { console.error(`${name} başlatılamadı:`, error); stop(1); });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      if (signal) console.log(`${name} ${signal} sinyaliyle kapandı.`);
      stop(code ?? 1);
    }
  });
  return child;
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null && !child.killed) child.kill();
  process.exitCode = exitCode;
}

async function waitForApi() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:3000/api/health');
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch { /* The API child may need a moment to bind its port. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('API 10 saniye içinde hazır olmadı.');
}

async function angularPortIsAvailable(port) {
  return await portIsAvailable(port, '127.0.0.1') && await portIsAvailable(port, '::1');
}

async function start() {
  let existingApi = false;
  try {
    const response = await fetch('http://127.0.0.1:3000/api/health');
    existingApi = response.ok && (await response.json()).status === 'ok';
  } catch { /* No API is running yet. */ }

  if (existingApi) {
    console.log('Mevcut Denge API bağlantısı kullanılacak.');
  } else if (await portIsAvailable(3000, '::')) {
    spawnChild([path.join(projectRoot, 'server', 'index.cjs')], 'Denge API');
    await waitForApi();
  } else {
    throw new Error('Port 3000 başka bir uygulama tarafından kullanılıyor.');
  }

  let port = 4200;
  while (port < 4300 && !(await angularPortIsAvailable(port))) port++;
  if (port === 4300) throw new Error('4200–4299 aralığında boş bir port bulunamadı.');
  if (port !== 4200) console.log(`4200 portu kullanımda; Angular ${port} portunda başlatılıyor.`);
  spawnChild([angularCli, 'serve', '--host', '127.0.0.1', '--port', String(port)], 'Angular');
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
start().catch((error) => { console.error(error.message); stop(1); });
