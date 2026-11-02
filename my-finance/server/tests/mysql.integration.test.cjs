const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const request = require('supertest');
const loadLocalEnv = require('../../scripts/load-local-env.cjs');

loadLocalEnv(path.join(__dirname, '../..'));
if (process.env.MYSQL_TEST_MODE !== '1') throw new Error('Set MYSQL_TEST_MODE=1 to run tests against the configured MySQL test database.');
if (process.env.NODE_ENV === 'production') throw new Error('MySQL integration tests cannot run in production.');

const { app, db, migrate } = require('../mysql-server.cjs');
let testUserId;
let primary;
let expenseCategory;
let incomeCategory;

async function cleanupTestAccounts() {
  const [users] = await db.execute("SELECT id FROM users WHERE google_sub LIKE 'mysql-test-%' AND email LIKE 'mysql-test-%@example.invalid'");
  for (const user of users) {
    const id = Number(user.id);
    await db.execute('DELETE FROM transactions WHERE user_id=?', [id]);
    await db.execute('DELETE FROM categories WHERE user_id=?', [id]);
    await db.execute('DELETE FROM settings WHERE user_id=?', [id]);
    await db.execute('DELETE FROM auth_sessions WHERE user_id=?', [id]);
    await db.execute('DELETE FROM users WHERE id=?', [id]);
  }
}

before(async () => {
  await migrate();
  await cleanupTestAccounts();
  const suffix = crypto.randomBytes(8).toString('hex');
  const [user] = await db.execute('INSERT INTO users(google_sub,email,name) VALUES (?,?,?)', [`mysql-test-${suffix}`, `mysql-test-${suffix}@example.invalid`, 'MySQL test hesabı']);
  testUserId = Number(user.insertId);
  const [expense] = await db.execute('INSERT INTO categories(user_id,name,type,color,icon,is_default,is_preferred) VALUES (?,?,?,?,?,1,1)', [testUserId, 'Market', 'Expense', '#8b5cf6', 'basket']);
  const [income] = await db.execute('INSERT INTO categories(user_id,name,type,color,icon,is_default,is_preferred) VALUES (?,?,?,?,?,1,1)', [testUserId, 'Maaş', 'Income', '#10b981', 'briefcase']);
  expenseCategory = Number(expense.insertId);
  incomeCategory = Number(income.insertId);
  await db.execute('INSERT INTO settings(user_id,currency,theme,language) VALUES (?,?,?,?)', [testUserId, 'TRY', 'light', 'tr']);
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await db.execute('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', [tokenHash, testUserId, Math.floor(Date.now() / 1000) + 600]);
  const cookie = `denge_session=${token}`;
  const withCookie = method => url => request(app)[method](url).set('Cookie', cookie);
  primary = { get: withCookie('get'), post: withCookie('post'), put: withCookie('put'), delete: withCookie('delete') };
});

after(async () => {
  if (testUserId) await cleanupTestAccounts();
  await db.end();
});

test('runs authenticated transaction, category, dashboard, report, settings, and persistence flows on MySQL', async () => {
  await request(app).get('/api/transactions').expect(401);
  await primary.get('/api/categories').expect(200);

  const otherSuffix = crypto.randomBytes(8).toString('hex');
  const [otherUser] = await db.execute('INSERT INTO users(google_sub,email,name) VALUES (?,?,?)', [`mysql-test-${otherSuffix}`, `mysql-test-${otherSuffix}@example.invalid`, 'İkinci test hesabı']);
  const otherUserId = Number(otherUser.insertId);
  const otherToken = crypto.randomBytes(32).toString('base64url');
  const otherHash = crypto.createHash('sha256').update(otherToken).digest('hex');
  await db.execute('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', [otherHash, otherUserId, Math.floor(Date.now() / 1000) + 600]);
  const otherTransactions = () => request(app).get('/api/transactions').set('Cookie', `denge_session=${otherToken}`);
  assert.deepEqual((await otherTransactions().expect(200)).body, []);

  const expense = await primary.post('/api/transactions').send({ type: 'Expense', amount: 2599, description: 'MySQL test gideri', category_id: expenseCategory, transaction_date: '2026-11-02' }).expect(201);
  const income = await primary.post('/api/transactions').send({ type: 'Income', amount: 70000, description: 'MySQL test geliri', category_id: incomeCategory, transaction_date: '2026-11-02' }).expect(201);
  assert.equal(expense.body.amount, 2599);
  assert.equal(income.body.amount, 70000);
  assert.deepEqual((await otherTransactions().expect(200)).body, []);
  await primary.post('/api/transactions').send({}).expect(400);
  await primary.post('/api/transactions').send({ type: 'Expense', amount: 0, description: 'Geçersiz', category_id: expenseCategory, transaction_date: '2026-11-02' }).expect(400);
  await primary.post('/api/transactions').send({ type: 'Expense', amount: -1, description: 'Geçersiz', category_id: expenseCategory, transaction_date: '2026-11-02' }).expect(400);
  await primary.post('/api/transactions').send({ type: 'Expense', amount: 1.25, description: 'Geçersiz', category_id: expenseCategory, transaction_date: '2026-11-02' }).expect(400);
  await primary.post('/api/transactions').send({ type: 'Expense', amount: 100, description: 'Geçersiz tarih', category_id: expenseCategory, transaction_date: '2026-02-30' }).expect(400);
  await primary.post('/api/transactions').send({ type: 'Income', amount: 100, description: 'Yanlış kategori', category_id: expenseCategory, transaction_date: '2026-11-02' }).expect(400);

  const summary = await primary.get('/api/dashboard/summary').expect(200);
  assert.equal(summary.body.balance, 67401);
  assert.equal(summary.body.income, 70000);
  assert.equal(summary.body.expense, 2599);

  const monthly = await primary.get('/api/reports/monthly?year=2026').expect(200);
  assert.equal(monthly.body[10].income, 70000);
  assert.equal(monthly.body[10].expense, 2599);
  assert.ok((await primary.get('/api/reports/yearly').expect(200)).body.some(row => row.year === '2026'));

  const edited = await primary.put(`/api/transactions/${expense.body.id}`).send({ type: 'Expense', amount: 3000, description: 'Düzenlenmiş MySQL gideri', category_id: expenseCategory, transaction_date: '2026-11-03' }).expect(200);
  assert.equal(edited.body.amount, 3000);
  await primary.post('/api/transactions').send({ type: 'Expense', amount: 0, description: 'Geçersiz', category_id: expenseCategory, transaction_date: '2026-11-02' }).expect(400);

  const customCategory = await primary.post('/api/categories').send({ name: 'MySQL test kategorisi', type: 'Expense', color: '#5261ac', icon: 'paw' }).expect(201);
  assert.equal(customCategory.body.icon, 'paw');
  await primary.put(`/api/categories/${customCategory.body.id}/preferred`).send({}).expect(200);
  const preferredCategories = (await primary.get('/api/categories').expect(200)).body;
  assert.equal(preferredCategories.find(category => category.id === customCategory.body.id).is_preferred, 1);
  await primary.post('/api/categories').send({ name: 'MySQL test kategorisi', type: 'Expense' }).expect(409);
  await primary.delete(`/api/categories/${expenseCategory}`).expect(400);
  await primary.put(`/api/categories/${customCategory.body.id}`).send({ name: 'Düzenlenmiş test kategorisi', color: '#5261ac', icon: 'book' }).expect(200);
  const used = await primary.post('/api/transactions').send({ type: 'Expense', amount: 120, description: 'Kategori FK testi', category_id: customCategory.body.id, transaction_date: '2026-11-02' }).expect(201);
  await primary.delete(`/api/categories/${customCategory.body.id}`).expect(409);

  await primary.put('/api/settings').send({ theme: 'dark' }).expect(200).expect(response => assert.equal(response.body.theme, 'dark'));
  const stored = await db.execute('SELECT amount FROM transactions WHERE id=? AND user_id=?', [expense.body.id, testUserId]);
  assert.equal(Number(stored[0][0].amount), 3000);

  await primary.delete(`/api/transactions/${used.body.id}`).expect(204);
  await primary.delete(`/api/transactions/${expense.body.id}`).expect(204);
  await primary.delete(`/api/transactions/${income.body.id}`).expect(204);
  await primary.delete(`/api/categories/${customCategory.body.id}`).expect(204);
});
