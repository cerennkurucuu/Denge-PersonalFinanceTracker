const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const request = require('supertest');
const Database = require('better-sqlite3');
const { verifyGoogleIdToken } = require('../google-id-token.cjs');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denge-api-'));
process.env.DATABASE_PATH = path.join(tempDir, 'finance.sqlite');
const { app, db } = require('../index.cjs');
let expenseCategory; let incomeCategory; let transactionId;
let primary;

function createTestAccount(sub, email) {
  const userId = Number(db.prepare('INSERT INTO users(google_sub,email,name) VALUES (?,?,?)').run(sub, email, email.split('@')[0]).lastInsertRowid);
  db.prepare("INSERT INTO categories(user_id,name,type,color,icon,is_default) VALUES (?,'Market','Expense','#8b5cf6','basket',1)").run(userId);
  db.prepare("INSERT INTO categories(user_id,name,type,color,icon,is_default) VALUES (?,'Maaş','Income','#10b981','briefcase',1)").run(userId);
  db.prepare("INSERT INTO settings(user_id,currency,theme,language) VALUES (?,'TRY','light','tr')").run(userId);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'), userId, Math.floor(Date.now() / 1000) + 3600);
  const cookie = `denge_session=${token}`;
  const withCookie = method => url => request(app)[method](url).set('Cookie', cookie);
  return { id: userId, get: withCookie('get'), post: withCookie('post'), put: withCookie('put'), delete: withCookie('delete') };
}

before(async () => {
  primary = createTestAccount('google-test-sub-1', 'ceren@example.test');
  const categories = (await primary.get('/api/categories').expect(200)).body;
  expenseCategory = categories.find(category => category.name === 'Market' && category.type === 'Expense');
  incomeCategory = categories.find(category => category.name === 'Maaş' && category.type === 'Income');
});

after(() => { if (db.open) db.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });

test('uses Google Auth Library to verify ID tokens against the configured audience', async () => {
  let verifyOptions;
  const payload = { sub: 'stable-google-sub', email: 'user@example.com', email_verified: true };
  const client = {
    verifyIdToken: async options => {
      verifyOptions = options;
      return { getPayload: () => payload };
    },
  };
  assert.equal((await verifyGoogleIdToken('g'.repeat(120), 'web-client-id', client)).sub, payload.sub);
  assert.deepEqual(verifyOptions, { idToken: 'g'.repeat(120), audience: 'web-client-id' });
  await assert.rejects(verifyGoogleIdToken('short', 'web-client-id', client), /Google ID token/);
  await assert.rejects(verifyGoogleIdToken('g'.repeat(120), '', client), /audience/);
  await assert.rejects(verifyGoogleIdToken('g'.repeat(120), 'web-client-id', {
    verifyIdToken: async () => ({ getPayload: () => ({ sub: 'missing-email' }) }),
  }), /Google account identity/);
});

test('migrates existing records without assigning them to a new account', () => {
  const legacyPath = path.join(tempDir, 'legacy.sqlite');
  const legacy = new Database(legacyPath);
  legacy.exec(fs.readFileSync(path.join(__dirname, '../migrations/001-initial.sql'), 'utf8'));
  const categoryId = Number(legacy.prepare("INSERT INTO categories(name,type,color,icon) VALUES ('Eski özel','Expense','#5261ac','circle')").run().lastInsertRowid);
  const transactionId = Number(legacy.prepare("INSERT INTO transactions(type,amount,description,category_id,transaction_date) VALUES ('Expense',1234,'Eski kayıt',?,'2026-06-14')").run(categoryId).lastInsertRowid);
  legacy.pragma('foreign_keys = OFF');
  legacy.exec(fs.readFileSync(path.join(__dirname, '../migrations/002-user-ownership.sql'), 'utf8'));
  legacy.pragma('foreign_keys = ON');
  assert.equal(legacy.prepare('SELECT user_id FROM categories WHERE id=?').get(categoryId).user_id, null);
  assert.equal(legacy.prepare('SELECT user_id,amount FROM transactions WHERE id=?').get(transactionId).user_id, null);
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
  legacy.close();
});

test('requires a Google session and isolates data between accounts', async () => {
  await request(app).get('/api/transactions').expect(401);
  await request(app).get('/api/categories').expect(401);
  await request(app).post('/api/auth/google').set('Origin', 'https://attacker.example').send({ credential: 'forged' }).expect(403);
  const other = createTestAccount('google-test-sub-2', 'other@example.test');
  await other.get('/api/auth/me').expect(200).expect(response => assert.equal(response.body.user.email, 'other@example.test'));
  const saved = await primary.post('/api/transactions').send({ type: 'Expense', amount: 250, description: 'Kişisel kayıt', category_id: expenseCategory.id, transaction_date: '2026-06-14' }).expect(201);
  assert.deepEqual((await other.get('/api/transactions').expect(200)).body, []);
  assert.equal((await other.get('/api/dashboard/summary').expect(200)).body.balance, 0);
  assert.equal((await other.get('/api/categories').expect(200)).body.some(category => category.name === 'Özel kategori'), false);
  await other.put(`/api/categories/${expenseCategory.id}`).send({ name: 'Başkasının kategorisi', color: '#5261ac' }).expect(404);
  await other.delete(`/api/transactions/${saved.body.id}`).expect(404);
  await primary.post('/api/categories').send({ name: 'Özel kategori', type: 'Expense' }).expect(201);
  assert.equal((await other.get('/api/categories').expect(200)).body.some(category => category.name === 'Özel kategori'), false);
  await primary.delete(`/api/transactions/${saved.body.id}`).expect(204);
  await other.post('/api/auth/logout').expect(204);
  await other.get('/api/categories').expect(401);
});

test('rejects empty, zero, negative, invalid date, and mismatched category transactions', async () => {
  await primary.post('/api/transactions').send({}).expect(400);
  const base = { type: 'Expense', amount: 1000, description: 'Market', category_id: expenseCategory.id, transaction_date: '2026-06-15' };
  await primary.post('/api/transactions').send({ ...base, amount: 0 }).expect(400);
  await primary.post('/api/transactions').send({ ...base, amount: 1000.5 }).expect(400);
  await primary.post('/api/transactions').send({ ...base, amount: -12 }).expect(400);
  await primary.post('/api/transactions').send({ ...base, transaction_date: '2026-02-30' }).expect(400);
  await primary.post('/api/transactions').send({ ...base, category_id: incomeCategory.id }).expect(400);
  await primary.post('/api/transactions').send({ ...base, description: '   ' }).expect(400);
});

test('creates, edits, lists, deletes transactions and computes integer-cent balances', async () => {
  const income = await primary.post('/api/transactions').send({ type: 'Income', amount: 125050, description: 'Maaş', category_id: incomeCategory.id, transaction_date: '2026-06-01' }).expect(201);
  const expense = await primary.post('/api/transactions').send({ type: 'Expense', amount: 1099, description: 'Kahve', category_id: expenseCategory.id, transaction_date: '2026-06-02' }).expect(201);
  transactionId = expense.body.id;
  assert.equal(income.body.amount, 125050);
  assert.equal((await primary.get('/api/dashboard/summary').expect(200)).body.balance, 123951);
  await primary.put(`/api/transactions/${transactionId}`).send({ type: 'Expense', amount: 1299, description: 'Kahve ve atıştırmalık', category_id: expenseCategory.id, transaction_date: '2026-06-03' }).expect(200);
  const list = await primary.get('/api/transactions?from=2026-06-01&to=2026-06-30').expect(200);
  assert.equal(list.body.length, 2);
  assert.equal((await primary.get('/api/reports/monthly?year=2026').expect(200)).body[5].expense, 1299);
  await primary.delete(`/api/transactions/${transactionId}`).expect(204);
  await primary.delete(`/api/transactions/${transactionId}`).expect(404);
});

test('supports category CRUD while protecting defaults and referenced categories', async () => {
  const added = await primary.post('/api/categories').send({ name: 'Kitaplar', type: 'Expense', color: '#5261ac' }).expect(201);
  await primary.put(`/api/categories/${added.body.id}`).send({ name: 'Kitap ve kırtasiye', color: '#5261ac' }).expect(200);
  await primary.delete(`/api/categories/${expenseCategory.id}`).expect(400);
  const usedTransaction = await primary.post('/api/transactions').send({ type: 'Expense', amount: 200, description: 'Kitap', category_id: added.body.id, transaction_date: '2026-06-10' }).expect(201);
  await primary.delete(`/api/categories/${added.body.id}`).expect(409);
  await primary.delete(`/api/transactions/${usedTransaction.body.id}`).expect(204);
  await primary.delete(`/api/categories/${added.body.id}`).expect(204);
});

test('serves settings and yearly report endpoints with validated settings', async () => {
  await primary.get('/api/settings').expect(200).expect(response => assert.equal(response.body.currency, 'TRY'));
  await primary.put('/api/settings').send({ theme: 'dark' }).expect(200).expect(response => assert.equal(response.body.theme, 'dark'));
  await primary.put('/api/settings').send({ currency: 'USD' }).expect(400);
  const years = await primary.get('/api/reports/yearly').expect(200);
  assert.ok(years.body.some(year => year.year === '2026'));
});

test('keeps saved data available through a new database connection', async () => {
  const saved = await primary.post('/api/transactions').send({ type: 'Income', amount: 1234, description: 'Test kalıcılığı', category_id: incomeCategory.id, transaction_date: '2026-07-01' }).expect(201);
  assert.equal(saved.body.description, 'Test kalıcılığı');
  assert.equal(db.prepare('SELECT amount FROM transactions WHERE id=?').get(saved.body.id).amount, 1234);
  db.close();
  const reopened = new Database(process.env.DATABASE_PATH);
  assert.equal(reopened.prepare('SELECT amount FROM transactions WHERE id=?').get(saved.body.id).amount, 1234);
  reopened.close();
});
