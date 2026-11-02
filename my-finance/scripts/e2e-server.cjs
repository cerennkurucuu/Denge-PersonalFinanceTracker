const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denge-playwright-'));
const apiPort = 3301;
const clientPort = 4202;
const sessionToken = 'denge-playwright-session-token';
let shuttingDown = false;

process.env.DATABASE_PATH = path.join(tempDir, 'finance-e2e.sqlite');
process.env.PORT = String(apiPort);
process.env.NODE_ENV = 'development';

const { app, db } = require('../server/index.cjs');
const userId = Number(db.prepare('INSERT INTO users(google_sub,email,name) VALUES (?,?,?)')
  .run('playwright-google-sub', 'deniz@example.test', 'Deniz Örnek').lastInsertRowid);

const addCategory = db.prepare(`
  INSERT INTO categories(user_id,name,type,color,icon,is_default,is_preferred)
  VALUES (?,?,?,?,?,?,?)
`);
const marketId = Number(addCategory.run(userId, 'Market', 'Expense', '#8b5cf6', 'basket', 1, 1).lastInsertRowid);
const transportId = Number(addCategory.run(userId, 'Ulaşım', 'Expense', '#f59e0b', 'car', 1, 0).lastInsertRowid);
const salaryId = Number(addCategory.run(userId, 'Maaş', 'Income', '#10b981', 'briefcase', 1, 1).lastInsertRowid);
db.prepare("INSERT INTO settings(user_id,currency,theme,language) VALUES (?,'TRY','light','tr')").run(userId);
const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
  .run(tokenHash, userId, Math.floor(Date.now() / 1000) + 60 * 60);

const year = new Date().getFullYear();
const insertTransaction = db.prepare(`
  INSERT INTO transactions(user_id,type,amount,description,category_id,transaction_date)
  VALUES (?,?,?,?,?,?)
`);
insertTransaction.run(userId, 'Income', 8_500_000, 'Örnek maaş', salaryId, `${year}-01-05`);
insertTransaction.run(userId, 'Expense', 1_200_000, 'Ocak market alışverişi', marketId, `${year}-01-10`);
insertTransaction.run(userId, 'Expense', 150_000, 'Şubat ulaşım kartı', transportId, `${year}-02-15`);

const apiServer = app.listen(apiPort, '127.0.0.1');
apiServer.on('error', error => { console.error('E2E API başlatılamadı:', error.message); shutdown(1); });

const angularCli = require.resolve('@angular/cli/bin/ng.js', { paths: [projectRoot] });
const client = spawn(process.execPath, [
  angularCli, 'serve', '--host', '127.0.0.1', '--port', String(clientPort), '--proxy-config', 'proxy.e2e.conf.json',
], { cwd: projectRoot, stdio: 'inherit', env: process.env });
client.on('error', error => { console.error('E2E Angular sunucusu başlatılamadı:', error.message); shutdown(1); });
client.on('exit', code => { if (!shuttingDown) shutdown(code || 1); });

async function waitForClient() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${clientPort}/api/health`);
      if (response.ok && (await response.json()).status === 'ok') {
        console.log(`İzole E2E ortamı http://127.0.0.1:${clientPort} adresinde hazır.`);
        return;
      }
    } catch { /* Angular may still be compiling. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.error('E2E uygulaması zamanında başlamadı.');
  shutdown(1);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (client.exitCode === null) client.kill();
  apiServer.close(() => {
    if (db.open) db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    process.exitCode = exitCode;
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
waitForClient();
