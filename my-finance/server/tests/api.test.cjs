const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denge-api-'));
process.env.DATABASE_PATH = path.join(tempDir, 'finance.sqlite');
const { app, db } = require('../index.cjs');
let expenseCategory; let incomeCategory; let transactionId;

before(async () => {
  const categories = (await request(app).get('/api/categories').expect(200)).body;
  expenseCategory = categories.find(category => category.name === 'Market' && category.type === 'Expense');
  incomeCategory = categories.find(category => category.name === 'Maaş' && category.type === 'Income');
});

after(() => { db.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });

test('rejects empty, zero, negative, invalid date, and mismatched category transactions', async () => {
  await request(app).post('/api/transactions').send({}).expect(400);
  const base = { type: 'Expense', amount: 1000, description: 'Market', category_id: expenseCategory.id, transaction_date: '2026-06-15' };
  await request(app).post('/api/transactions').send({ ...base, amount: 0 }).expect(400);
  await request(app).post('/api/transactions').send({ ...base, amount: -12 }).expect(400);
  await request(app).post('/api/transactions').send({ ...base, transaction_date: '2026-02-30' }).expect(400);
  await request(app).post('/api/transactions').send({ ...base, category_id: incomeCategory.id }).expect(400);
});

test('creates, edits, lists, deletes transactions and computes integer-cent balances', async () => {
  const income = await request(app).post('/api/transactions').send({ type: 'Income', amount: 125050, description: 'Maaş', category_id: incomeCategory.id, transaction_date: '2026-06-01' }).expect(201);
  const expense = await request(app).post('/api/transactions').send({ type: 'Expense', amount: 1099, description: 'Kahve', category_id: expenseCategory.id, transaction_date: '2026-06-02' }).expect(201);
  transactionId = expense.body.id;
  assert.equal(income.body.amount, 125050);
  assert.equal((await request(app).get('/api/dashboard/summary').expect(200)).body.balance, 123951);
  await request(app).put(`/api/transactions/${transactionId}`).send({ type: 'Expense', amount: 1299, description: 'Kahve ve atıştırmalık', category_id: expenseCategory.id, transaction_date: '2026-06-03' }).expect(200);
  const list = await request(app).get('/api/transactions?from=2026-06-01&to=2026-06-30').expect(200);
  assert.equal(list.body.length, 2);
  assert.equal((await request(app).get('/api/reports/monthly?year=2026').expect(200)).body[5].expense, 1299);
  await request(app).delete(`/api/transactions/${transactionId}`).expect(204);
  await request(app).delete(`/api/transactions/${transactionId}`).expect(404);
});

test('supports category CRUD while protecting defaults and referenced categories', async () => {
  const added = await request(app).post('/api/categories').send({ name: 'Kitaplar', type: 'Expense', color: '#5261ac' }).expect(201);
  await request(app).put(`/api/categories/${added.body.id}`).send({ name: 'Kitap ve kırtasiye', color: '#5261ac' }).expect(200);
  await request(app).delete(`/api/categories/${expenseCategory.id}`).expect(400);
  await request(app).delete(`/api/categories/${added.body.id}`).expect(204);
});

test('keeps saved data available through a new database connection', async () => {
  const saved = await request(app).post('/api/transactions').send({ type: 'Income', amount: 1234, description: 'Test kalıcılığı', category_id: incomeCategory.id, transaction_date: '2026-07-01' }).expect(201);
  assert.equal(saved.body.description, 'Test kalıcılığı');
  assert.equal(db.prepare('SELECT amount FROM transactions WHERE id=?').get(saved.body.id).amount, 1234);
});
