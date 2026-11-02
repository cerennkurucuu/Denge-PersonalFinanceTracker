const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const loadLocalEnv = require('./load-local-env.cjs');

const projectRoot = path.join(__dirname, '..');
loadLocalEnv(projectRoot);
if (process.env.NODE_ENV === 'production') throw new Error('E2E cannot run against a production database.');
process.env.MYSQL_TEST_MODE = '1';

const apiPort = 3301;
const clientPort = 4202;
process.env.APP_ORIGIN = `http://127.0.0.1:${clientPort}`;
const sessionToken = 'denge-playwright-session-token';
let apiServer;
let client;
let testUserId;
let shuttingDown = false;

const { app, db, migrate } = require('../server/mysql-server.cjs');

async function cleanupTestUser() {
  if (!testUserId) return;
  await db.execute('DELETE FROM transactions WHERE user_id=?', [testUserId]);
  await db.execute('DELETE FROM categories WHERE user_id=?', [testUserId]);
  await db.execute('DELETE FROM settings WHERE user_id=?', [testUserId]);
  await db.execute('DELETE FROM auth_sessions WHERE user_id=?', [testUserId]);
  await db.execute('DELETE FROM users WHERE id=?', [testUserId]);
  testUserId = undefined;
}

async function seedTestUser() {
  const suffix = process.env.MYSQL_E2E_RUN_ID;
  if (!suffix) throw new Error('Missing isolated MySQL E2E run identifier.');
  const [user] = await db.execute('INSERT INTO users(google_sub,email,name) VALUES (?,?,?)', [`playwright-test-${suffix}`, `playwright-test-${suffix}@example.invalid`, 'Deniz Örnek']);
  testUserId = Number(user.insertId);
  const addCategory = async (name, type, color, icon, preferred) => {
    const [result] = await db.execute('INSERT INTO categories(user_id,name,type,color,icon,is_default,is_preferred) VALUES (?,?,?,?,?,1,?)', [testUserId, name, type, color, icon, preferred]);
    return Number(result.insertId);
  };
  const marketId = await addCategory('Market', 'Expense', '#35644c', 'basket', 1);
  const transportId = await addCategory('Ulaşım', 'Expense', '#f59e0b', 'car', 0);
  const salaryId = await addCategory('Maaş', 'Income', '#10b981', 'briefcase', 1);
  await db.execute('INSERT INTO settings(user_id,currency,theme,language) VALUES (?,?,?,?)', [testUserId, 'TRY', 'light', 'tr']);
  const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  await db.execute('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', [tokenHash, testUserId, Math.floor(Date.now() / 1000) + 3600]);

  const year = new Date().getFullYear();
  const seed = async (type, amount, description, categoryId, date) => db.execute('INSERT INTO transactions(user_id,type,amount,original_amount,currency_code,exchange_rate,rate_source,description,category_id,transaction_date) VALUES (?,?,?,? ,\'TRY\',1,\'TRY\',?,?,?)', [testUserId, type, amount, amount, description, categoryId, date]);
  await seed('Income', 8_500_000, 'Örnek maaş', salaryId, `${year}-01-05`);
  await seed('Expense', 1_200_000, 'Ocak market alışverişi', marketId, `${year}-01-10`);
  await seed('Expense', 150_000, 'Şubat ulaşım kartı', transportId, `${year}-02-15`);
}

async function waitForClient() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${clientPort}/api/health`);
      if (response.ok) {
        const health = await response.json();
        if (health.status === 'ok' && health.database === 'mysql') {
          console.log(`MySQL E2E ortamı http://127.0.0.1:${clientPort} adresinde hazır.`);
          return;
        }
      }
    } catch { /* Angular may still be compiling. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('E2E Angular sunucusu zamanında başlamadı.');
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (client && client.exitCode === null) client.kill();
  if (apiServer) await new Promise(resolve => apiServer.close(resolve));
  try { await cleanupTestUser(); } catch (error) { console.error('E2E test verileri temizlenemedi:', error.code || 'UNKNOWN'); exitCode = 1; }
  await db.end().catch(() => {});
  process.exitCode = exitCode;
}

async function start() {
  try {
    await migrate();
    await seedTestUser();
    process.env.PORT = String(apiPort);
    apiServer = app.listen(apiPort, '127.0.0.1');
    apiServer.on('error', error => { console.error('E2E API açılamadı:', error.code || 'UNKNOWN'); shutdown(1); });
    const angularCli = require.resolve('@angular/cli/bin/ng.js', { paths: [projectRoot] });
    const clientEnv = { ...process.env };
    delete clientEnv.PORT;
    client = spawn(process.execPath, [
      angularCli, 'serve', '--host', '127.0.0.1', '--port', String(clientPort), '--proxy-config', 'proxy.e2e.conf.json',
    ], { cwd: projectRoot, stdio: 'inherit', env: clientEnv });
    client.on('error', error => { console.error('E2E Angular başlatılamadı:', error.code || 'UNKNOWN'); shutdown(1); });
    client.on('exit', code => { if (!shuttingDown) shutdown(code || 1); });
    await waitForClient();
  } catch (error) {
    console.error('MySQL E2E ortamı başlatılamadı:', error.code || error.message);
    await shutdown(1);
  }
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
start();
