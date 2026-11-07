const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const request = require('supertest');
const loadLocalEnv = require('../../scripts/load-local-env.cjs');
const { codeAt } = require('../totp.cjs');

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
    await db.execute('DELETE FROM calendar_plans WHERE user_id=?', [id]);
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
  primary = { cookie, get: withCookie('get'), post: withCookie('post'), put: withCookie('put'), patch: withCookie('patch'), delete: withCookie('delete') };
});

const tryTransaction = (fields = {}) => ({
  currency_code: 'TRY', exchange_rate: 1, rate_source: 'TRY', rate_effective_date: null,
  amount: 100, original_amount: 100, type: 'Expense', description: 'MySQL test', category_id: expenseCategory, transaction_date: '2026-11-02',
  ...fields,
});

test('imports 10,000 synthetic rows in batches and returns the exact scoped income total', async t => {
  const date='2026-10-17';
  const items=Array.from({length:10000},(_,i)=>({...tryTransaction({type:'Income',category_id:incomeCategory,amount:1000+i,original_amount:1000+i,transaction_date:date,description:`Bulk benchmark ${i}`}),entry_kind:'standard',merchant_name:`Benchmark ${i}`,tcmb_rate:null,learnMerchant:false}));
  // Use a persistent real HTTP server and Node's native client for large-body
  // transfer; Supertest remains in use for the other endpoint assertions.
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const bulkPost=async(url,body,status)=>{
    const response=await fetch('http://127.0.0.1:'+server.address().port+url,{method:'POST',headers:{'Content-Type':'application/json',Cookie:primary.cookie},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    const parsed=await response.json();assert.equal(response.status,status,parsed.error);return {body:parsed};
  };
  try {
  const previewStarted=performance.now();
  const preview=await bulkPost('/api/statements/check',{items},200);
  assert.equal(preview.body.items.length,10000);
  t.diagnostic(`10,000-row duplicate/category preview: ${Math.round(performance.now()-previewStarted)} ms`);
  const started=performance.now();
  const result=await bulkPost('/api/statements/import',{fileSha256:crypto.randomBytes(32).toString('hex'),fileName:'synthetic.csv',skippedCount:0,items},201);
  t.diagnostic(`10,000 rows: ${Math.round(performance.now()-started)} ms`);
  assert.equal(result.body.result.imported,10000);
  const totals=await primary.get(`/api/reports/totals?type=Income&from=${date}&to=${date}`).expect(200);
  assert.equal(totals.body.amount,59995000);
  assert.equal(totals.body.issues,0);
  const [logs]=await db.execute('SELECT COUNT(*) count FROM exchange_rate_logs WHERE user_id=? AND transaction_id IN (SELECT id FROM transactions WHERE user_id=? AND import_batch_id=?)',[testUserId,testUserId,result.body.result.batchId]);
  assert.equal(Number(logs[0].count),10000);
  await db.execute('DELETE FROM transactions WHERE user_id=? AND import_batch_id=?',[testUserId,result.body.result.batchId]);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('stops reports and analysis when a legacy imported amount is actually a date', async () => {
  const [bad]=await db.execute('INSERT INTO transactions(user_id,type,amount,original_amount,currency_code,exchange_rate,rate_source,description,category_id,transaction_date,import_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[testUserId,'Income',3110202600,3110202600,'TRY',1,'TRY','Synthetic legacy date regression',incomeCategory,'2026-10-31',crypto.randomBytes(32).toString('hex')]);
  try {
    const total=await primary.get('/api/reports/totals?type=Income&from=2026-10-01&to=2026-10-31').expect(200);
    assert.equal(total.body.issues,1);
    await primary.get('/api/dashboard/summary').expect(422);
    await primary.get('/api/reports/monthly?year=2026').expect(422);
    await primary.get('/api/reports/analysis?from=2026-10-01&to=2026-10-31').expect(422);
  } finally { await db.execute('DELETE FROM transactions WHERE id=? AND user_id=?',[bad.insertId,testUserId]); }
});

test('replays MySQL migrations safely if DDL finished before version records were written', async () => {
  const [inserted] = await db.execute(
    'INSERT INTO transactions(user_id,type,amount,original_amount,currency_code,exchange_rate,rate_source,description,category_id,transaction_date) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [testUserId, 'Expense', 98765, 98765, 'TRY', 1, 'TRY', 'Migration data retention test', expenseCategory, '2026-11-02'],
  );
  for (const migration of ['002-currency-transactions', '003-tenant-foreign-keys', '004-import-and-planning', '005-duplicate-import-preferences', '007-session-timeout', '008-authenticator-mfa', '009-totp-replay-prevention']) {
    const [result] = await db.execute('DELETE FROM schema_migrations WHERE version=?', [migration]);
    assert.equal(result.affectedRows, 1);
  }

  await migrate();

  const [columns] = await db.execute(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    ['transactions'],
  );
  const names = new Set(columns.map(column => column.COLUMN_NAME));
  for (const column of ['original_amount', 'currency_code', 'exchange_rate', 'tcmb_rate', 'rate_source', 'rate_effective_date', 'entry_kind', 'merchant_name', 'import_fingerprint', 'deduplication_key', 'import_batch_id']) {
    assert.ok(names.has(column), `Expected migration column ${column} to exist`);
  }
  const [records] = await db.execute('SELECT version FROM schema_migrations WHERE version IN (?,?,?,?,?,?,?)', ['002-currency-transactions', '003-tenant-foreign-keys', '004-import-and-planning', '005-duplicate-import-preferences', '007-session-timeout', '008-authenticator-mfa', '009-totp-replay-prevention']);
  assert.equal(records.length, 7);
  const [planningTables] = await db.execute("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('statement_imports','merchant_category_rules','financial_plans','plan_category_preferences','plan_progress','recommendation_feedback')");
  assert.equal(planningTables.length, 6);
  const [ownershipConstraints] = await db.execute(
    "SELECT TABLE_NAME,CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('transactions_category_user_fk','exchange_rate_logs_transaction_user_fk')",
  );
  assert.equal(ownershipConstraints.length, 2);
  const [ownershipColumns] = await db.execute(
    "SELECT TABLE_NAME,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='user_id' AND TABLE_NAME IN ('categories','transactions','settings')",
  );
  assert.equal(ownershipColumns.length, 3);
  assert.ok(ownershipColumns.every(column => column.IS_NULLABLE === 'NO'));
  const [preserved] = await db.execute('SELECT amount,original_amount,currency_code FROM transactions WHERE id=? AND user_id=?', [Number(inserted.insertId), testUserId]);
  assert.equal(Number(preserved[0].amount), 98765);
  assert.equal(Number(preserved[0].original_amount), 98765);
  assert.equal(preserved[0].currency_code, 'TRY');
  await db.execute('DELETE FROM transactions WHERE id=? AND user_id=?', [Number(inserted.insertId), testUserId]);
});

test('supports encrypted authenticator enrollment, login challenge, and verified disable', async () => {
  assert.match(process.env.MFA_ENCRYPTION_KEY || '', /^[a-f\d]{64}$/i, 'run npm run security:setup first');
  await primary.get('/api/auth/mfa/status').expect(200,{enabled:false});
  const setup=await primary.post('/api/auth/mfa/setup').send({}).expect(200);
  assert.match(setup.body.secret,/^[A-Z2-7]{32}$/);
  const [stored]=await db.execute('SELECT totp_pending_secret_encrypted FROM users WHERE id=?',[testUserId]);
  assert.ok(stored[0].totp_pending_secret_encrypted);
  assert.notEqual(stored[0].totp_pending_secret_encrypted,setup.body.secret);
  await primary.post('/api/auth/mfa/enable').send({code:'000000'}).expect(400);
  const code=codeAt(setup.body.secret,Math.floor(Date.now()/30_000));
  const enabled=await primary.post('/api/auth/mfa/enable').send({code}).expect(200);
  assert.equal(enabled.body.enabled,true);
  assert.equal(enabled.body.recoveryCodes.length,10);
  const [recoveryRows]=await db.execute('SELECT code_hash FROM auth_mfa_recovery_codes WHERE user_id=?',[testUserId]);
  assert.equal(recoveryRows.length,10);
  assert.notEqual(recoveryRows[0].code_hash,enabled.body.recoveryCodes[0].replaceAll('-',''));
  await primary.get('/api/auth/mfa/status').expect(200,{enabled:true});

  const challenge=crypto.randomBytes(32).toString('base64url');
  const challengeHash=crypto.createHash('sha256').update(challenge).digest('hex');
  await db.execute('INSERT INTO auth_mfa_challenges(token_hash,user_id,expires_at) VALUES (?,?,?)',[challengeHash,testUserId,Math.floor(Date.now()/1000)+300]);
  const loginCode=enabled.body.recoveryCodes[0];
  const login=await request(app).post('/api/auth/mfa/verify').set('Cookie',`denge_mfa_challenge=${challenge}`).send({code:loginCode}).expect(200);
  const sessionCookie=login.headers['set-cookie'].find(value=>value.startsWith('denge_session=')).split(';')[0];
  await request(app).get('/api/auth/me').set('Cookie',sessionCookie).expect(200);
  await request(app).post('/api/auth/mfa/verify').set('Cookie',`denge_mfa_challenge=${challenge}`).send({code:loginCode}).expect(401);

  const totpChallenge=crypto.randomBytes(32).toString('base64url');
  await db.execute('INSERT INTO auth_mfa_challenges(token_hash,user_id,expires_at) VALUES (?,?,?)',[crypto.createHash('sha256').update(totpChallenge).digest('hex'),testUserId,Math.floor(Date.now()/1000)+300]);
  const totpLoginCode=codeAt(setup.body.secret,Math.floor(Date.now()/30_000));
  await request(app).post('/api/auth/mfa/verify').set('Cookie',`denge_mfa_challenge=${totpChallenge}`).send({code:totpLoginCode}).expect(200);
  const replayChallenge=crypto.randomBytes(32).toString('base64url');
  await db.execute('INSERT INTO auth_mfa_challenges(token_hash,user_id,expires_at) VALUES (?,?,?)',[crypto.createHash('sha256').update(replayChallenge).digest('hex'),testUserId,Math.floor(Date.now()/1000)+300]);
  await request(app).post('/api/auth/mfa/verify').set('Cookie',`denge_mfa_challenge=${replayChallenge}`).send({code:totpLoginCode}).expect(401);

  const disableCode=codeAt(setup.body.secret,Math.floor((Date.now()+30_000)/30_000));
  await primary.post('/api/auth/mfa/disable').send({code:disableCode}).expect(200,{enabled:false});
  await primary.get('/api/auth/mfa/status').expect(200,{enabled:false});
});

test('persists configurable idle timeout and invalidates an idle server session', async () => {
  const initial=await primary.get('/api/settings').expect(200);
  assert.equal(initial.body.sessionTimeoutMinutes,10);
  await primary.put('/api/settings').send({sessionTimeoutMinutes:15}).expect(200);
  assert.equal((await primary.get('/api/settings').expect(200)).body.sessionTimeoutMinutes,15);
  await primary.put('/api/settings').send({sessionTimeoutMinutes:481}).expect(400);
  await primary.put('/api/settings').send({sessionTimeoutMinutes:10}).expect(200);

  const idleToken=crypto.randomBytes(32).toString('base64url');
  const idleHash=crypto.createHash('sha256').update(idleToken).digest('hex');
  await db.execute('INSERT INTO auth_sessions(token_hash,user_id,expires_at,last_activity_at) VALUES (?,?,?,?)',[idleHash,testUserId,Math.floor(Date.now()/1000)+3600,Math.floor(Date.now()/1000)-601]);
  await request(app).get('/api/transactions').set('Cookie',`denge_session=${idleToken}`).expect(401);
  const [sessions]=await db.execute('SELECT token_hash FROM auth_sessions WHERE token_hash=?',[idleHash]);
  assert.equal(sessions.length,0);
});

after(async () => {
  if (testUserId) await cleanupTestAccounts();
  await db.end();
});

test('runs authenticated transaction, statement import, plan, report, settings, and persistence flows on MySQL', async () => {
  await request(app).get('/api/health').expect(200, { status: 'ok', database: 'mysql' });
  await request(app).get('/api/transactions').expect(401);
  await primary.get('/api/categories').expect(200);
  await primary.post('/api/transactions').set('Origin', 'https://attacker.invalid').send(tryTransaction()).expect(403);
  await request(app).get('/api/exchange-rates?currency=USD&date=2026-10-30').expect(401);
  await primary.get('/api/transactions?type=Unknown').expect(400);
  await primary.get('/api/transactions?from=2026-02-30').expect(400);
  await primary.get('/api/transactions?from=2026-11-02&to=2026-11-01').expect(400);
  await primary.get('/api/reports/monthly?year=99999').expect(400);
  await primary.delete('/api/transactions/not-an-id').expect(400);

  const realFetch = global.fetch;
  const requestedTcmbUrls = [];
  global.fetch = async url => {
    requestedTcmbUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      text: async () => '<Tarih_Date Tarih="30.10.2026"><Currency CurrencyCode="USD"><Unit>1</Unit><BanknoteBuying>42.2500</BanknoteBuying></Currency><Currency CurrencyCode="EUR"><Unit>1</Unit><BanknoteBuying>48.1000</BanknoteBuying></Currency></Tarih_Date>',
    };
  };
  try {
    const quote = await primary.get('/api/exchange-rates?currency=USD&date=2026-10-31').expect(200);
    assert.deepEqual(quote.body, { currency: 'USD', rate: 42.25, unit: 1, effectiveDate: '2026-10-30', source: 'TCMB', basis: 'Efektif alış' });
    const currencies = await primary.get('/api/exchange-rates/currencies').expect(200);
    assert.deepEqual(currencies.body.currencies, ['EUR', 'GBP', 'USD']);
    assert.deepEqual(requestedTcmbUrls, [
      'https://www.tcmb.gov.tr/kurlar/202610/30102026.xml',
      'https://www.tcmb.gov.tr/kurlar/today.xml',
    ]);
  } finally {
    global.fetch = realFetch;
  }

  const otherSuffix = crypto.randomBytes(8).toString('hex');
  const [otherUser] = await db.execute('INSERT INTO users(google_sub,email,name) VALUES (?,?,?)', [`mysql-test-${otherSuffix}`, `mysql-test-${otherSuffix}@example.invalid`, 'İkinci test hesabı']);
  const otherUserId = Number(otherUser.insertId);
  const [otherCategoryResult] = await db.execute('INSERT INTO categories(user_id,name,type,color,icon) VALUES (?,?,?,?,?)', [otherUserId, 'Diğer kullanıcının marketi', 'Expense', '#5261ac', 'basket']);
  const otherCategoryId = Number(otherCategoryResult.insertId);
  const otherToken = crypto.randomBytes(32).toString('base64url');
  const otherHash = crypto.createHash('sha256').update(otherToken).digest('hex');
  await db.execute('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', [otherHash, otherUserId, Math.floor(Date.now() / 1000) + 600]);
  const otherTransactions = () => request(app).get('/api/transactions').set('Cookie', `denge_session=${otherToken}`);
  assert.deepEqual((await otherTransactions().expect(200)).body, []);
  await assert.rejects(
    db.execute('INSERT INTO transactions(user_id,type,amount,original_amount,currency_code,exchange_rate,rate_source,description,category_id,transaction_date) VALUES (?,?,?,?,?,?,?,?,?,?)', [testUserId, 'Expense', 100, 100, 'TRY', 1, 'TRY', 'Cross-tenant FK test', otherCategoryId, '2026-11-02']),
    error => error.code === 'ER_NO_REFERENCED_ROW_2',
  );
  const otherCategoryTransaction = await request(app).post('/api/transactions').set('Cookie', `denge_session=${otherToken}`).send(tryTransaction({ category_id: otherCategoryId, description: 'Diğer kullanıcıya ait işlem' })).expect(201);
  await primary.get('/api/transactions').expect(200).expect(response => assert.equal(response.body.some(transaction => transaction.id === otherCategoryTransaction.body.id), false));
  await primary.get('/api/transactions/999999999/rate-history').expect(404);
  await primary.put(`/api/transactions/${otherCategoryTransaction.body.id}`).send(tryTransaction()).expect(404);
  await primary.delete(`/api/transactions/${otherCategoryTransaction.body.id}`).expect(404);
  await primary.put(`/api/categories/${otherCategoryId}/preferred`).send({}).expect(404);
  await primary.put(`/api/categories/${otherCategoryId}`).send({ name: 'Yetkisiz düzenleme' }).expect(404);
  await primary.delete(`/api/categories/${otherCategoryId}`).expect(404);

  const expense = await primary.post('/api/transactions').send(tryTransaction({ amount: 2599, original_amount: 2599, description: 'MySQL test gideri', category_id: expenseCategory })).expect(201);
  const income = await primary.post('/api/transactions').send(tryTransaction({ type: 'Income', amount: 70000, original_amount: 70000, description: 'MySQL test geliri', category_id: incomeCategory })).expect(201);
  assert.equal(expense.body.amount, 2599);
  assert.equal(income.body.amount, 70000);
  assert.deepEqual((await otherTransactions().expect(200)).body.map(transaction => transaction.id), [otherCategoryTransaction.body.id]);
  await primary.post('/api/transactions').send({}).expect(400);
  await primary.post('/api/transactions').send(tryTransaction({ amount: 0, original_amount: 0 })).expect(400);
  await primary.post('/api/transactions').send(tryTransaction({ amount: -1, original_amount: -1 })).expect(400);
  await primary.post('/api/transactions').send(tryTransaction({ amount: 1.25, original_amount: 1.25 })).expect(400);
  await primary.post('/api/transactions').send(tryTransaction({ transaction_date: '2026-02-30' })).expect(400);
  await primary.post('/api/transactions').send(tryTransaction({ type: 'Income', category_id: expenseCategory })).expect(400);

  await primary.get('/api/plans/scenarios?targetSavings=100').expect(422);
  await primary.get('/api/reports/analysis?from=2026-11-03&to=2026-11-02').expect(400);
  const importDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
  const importedItem = {
    type: 'Expense', entry_kind: 'standard', amount: 88_888, original_amount: 88_888, currency_code: 'TRY', exchange_rate: 1,
    tcmb_rate: null, rate_source: 'TRY', rate_effective_date: null, description: 'Migros ekstre test işlemi', merchant_name: 'Migros',
    category_id: expenseCategory, transaction_date: importDate, duplicateKind: null, confirmPotentialDuplicate: false, learnMerchant: true,
  };
  const statementPreview = await primary.post('/api/statements/check').send({ items: [{ transaction_date: importDate, description: importedItem.description, merchant_name: 'Migros', original_amount: 88_888, currency_code: 'TRY', type: 'Expense' }] }).expect(200);
  assert.equal(statementPreview.body.items[0].categoryId, expenseCategory);
  assert.equal(statementPreview.body.items[0].confidence, 'high');
  const fileHash = crypto.createHash('sha256').update(`mysql-integration-${crypto.randomBytes(12).toString('hex')}`).digest('hex');
  const importedStatement = await primary.post('/api/statements/import').send({ fileSha256: fileHash, fileName: 'private-account-details.csv', skippedCount: 0, items: [importedItem] }).expect(201);
  assert.equal(importedStatement.body.result.imported, 1);
  const importedTransaction = await primary.get('/api/transactions').expect(200).then(response => response.body.find(item => item.description === importedItem.description));
  assert.ok(importedTransaction);
  await primary.get('/api/settings').expect(200).expect(response => assert.equal(response.body.allowDuplicateImports, false));
  const duplicatePreview = await primary.post('/api/statements/check').send({ items: [{ transaction_date: importDate, description: importedItem.description, merchant_name: 'Migros', original_amount: 88_888, currency_code: 'TRY', type: 'Expense' }] }).expect(200);
  assert.equal(duplicatePreview.body.items[0].duplicate.kind, 'exact');
  const blockedDuplicate = await primary.post('/api/statements/import').send({ fileSha256: fileHash, fileName: 'private-account-details.csv', skippedCount: 0, items: [importedItem] }).expect(201);
  assert.equal(blockedDuplicate.body.result.imported, 0);
  assert.equal(blockedDuplicate.body.result.duplicates, 1);
  const importHistory = await primary.get('/api/statements').expect(200);
  assert.equal(importHistory.body[0].file_name, 'Ekstre.csv');
  await primary.get('/api/reports/analysis?from=2026-11-03&to=2026-11-06').expect(200);
  await primary.delete(`/api/transactions/${importedTransaction.id}`).expect(204);
  const restoredImport = await primary.post('/api/statements/import').send({ fileSha256: fileHash, fileName: 'private-account-details.csv', skippedCount: 0, items: [importedItem] }).expect(201);
  assert.equal(restoredImport.body.result.imported, 1);
  await primary.put('/api/settings').send({ allowDuplicateImports: true }).expect(200).expect(response => assert.equal(response.body.allowDuplicateImports, true));
  const permittedDuplicate = await primary.post('/api/statements/import').send({ fileSha256: fileHash, fileName: 'private-account-details.csv', skippedCount: 0, items: [importedItem] }).expect(201);
  assert.equal(permittedDuplicate.body.result.imported, 1);
  await primary.put('/api/settings').send({ allowDuplicateImports: false }).expect(200).expect(response => assert.equal(response.body.allowDuplicateImports, false));
  const blockedAgain = await primary.post('/api/statements/import').send({ fileSha256: fileHash, fileName: 'private-account-details.csv', skippedCount: 0, items: [importedItem] }).expect(201);
  assert.equal(blockedAgain.body.result.imported, 0);
  assert.equal(blockedAgain.body.result.duplicates, 1);
  const importedTransactions = await primary.get('/api/transactions').expect(200).then(response => response.body.filter(item => item.description === importedItem.description));
  for (const item of importedTransactions) await primary.delete(`/api/transactions/${item.id}`).expect(204);

  const customRuleCheck = await primary.post('/api/statements/check').send({ items: [{ transaction_date: importDate, description: 'Migros sonradan eşleşme', merchant_name: 'Migros', original_amount: 88_889, currency_code: 'TRY', type: 'Expense' }] }).expect(200);
  assert.equal(customRuleCheck.body.items[0].categoryId, expenseCategory);
  assert.equal(customRuleCheck.body.items[0].matchedRule, 'Kayıtlı tercihin');

  const [currentYear, currentMonth] = importDate.split('-').map(Number);
  const historicalTransactions = [];
  for (let offset = 3; offset >= 1; offset -= 1) {
    const monthDate = new Date(Date.UTC(currentYear, currentMonth - 1 - offset, 15)).toISOString().slice(0, 10);
    const historicalIncome = await primary.post('/api/transactions').send(tryTransaction({ type: 'Income', amount: 4_500_000, original_amount: 4_500_000, category_id: incomeCategory, description: 'Geçici plan testi geliri', transaction_date: monthDate })).expect(201);
    const historicalExpense = await primary.post('/api/transactions').send(tryTransaction({ amount: 4_920_000, original_amount: 4_920_000, category_id: expenseCategory, description: 'Geçici plan testi gideri', transaction_date: monthDate })).expect(201);
    historicalTransactions.push(historicalIncome.body.id, historicalExpense.body.id);
  }
  const planPreferences = await primary.get('/api/plans/preferences').expect(200);
  assert.equal(planPreferences.body.categories.find(category => category.categoryId === expenseCategory).monthlyAverage, 4_920_000);
  await primary.put('/api/plans/preferences').send({ categories: [{ categoryId: expenseCategory, protectedAmount: 1_900_000, reductionRate: 0.5 }] }).expect(200);
  const scenarios = await primary.get('/api/plans/scenarios?targetSavings=300000').expect(200);
  assert.equal(scenarios.body.inputs.monthlyIncome, 4_500_000);
  assert.equal(scenarios.body.inputs.monthlyExpense, 4_920_000);
  assert.equal(scenarios.body.inputs.currentDeficit, 420_000);
  assert.equal(scenarios.body.inputs.requiredImprovement, 720_000);
  assert.equal(scenarios.body.scenarios[1].netAfterPlan, 300_000);
  assert.ok(scenarios.body.scenarios[1].categoryTargets.some(category => category.categoryId === expenseCategory));
  const plan = await primary.post('/api/plans').send({ name: 'Dengeli test planı', targetSavings: 300_000, scenarioId: 'balanced' }).expect(201);
  const activePlan = await primary.get('/api/plans/current').expect(200);
  assert.equal(activePlan.body.plan.id, plan.body.id);
  assert.ok(activePlan.body.plan.category_targets.some(category => category.categoryId === expenseCategory));
  await primary.patch(`/api/plans/${plan.body.id}/status`).send({ status: 'completed' }).expect(200);
  assert.ok((await primary.get('/api/plans/history').expect(200)).body.some(item => item.id === plan.body.id && item.status === 'completed'));
  for (const id of historicalTransactions) await primary.delete(`/api/transactions/${id}`).expect(204);

  const fx = await primary.post('/api/transactions').send(tryTransaction({
    type: 'Expense', currency_code: 'USD', original_amount: 12_345, exchange_rate: '32.5000000000', tcmb_rate: '32.4000000000', rate_source: 'manual', rate_effective_date: '2026-11-02', amount: 401_213,
    description: 'USD test gideri',
  })).expect(201);
  assert.equal(fx.body.original_amount, 12_345);
  assert.equal(fx.body.amount, 401_213);
  assert.equal(fx.body.currency_code, 'USD');
  assert.deepEqual((await otherTransactions().expect(200)).body.map(transaction => transaction.id), [otherCategoryTransaction.body.id]);
  await request(app).get(`/api/transactions/${fx.body.id}/rate-history`).set('Cookie', `denge_session=${otherToken}`).expect(404);
  const rateHistory = await primary.get(`/api/transactions/${fx.body.id}/rate-history`).expect(200);
  assert.equal(rateHistory.body.length, 1);
  assert.equal(rateHistory.body[0].rate_source, 'manual');
  await primary.post('/api/transactions').send(tryTransaction({ currency_code: 'USD', original_amount: 100, amount: 3201, exchange_rate: '32', rate_source: 'manual', rate_effective_date: '2026-11-02' })).expect(400);

  const summary = await primary.get('/api/dashboard/summary').expect(200);
  assert.equal(summary.body.balance, -333812);
  assert.equal(summary.body.income, 70000);
  assert.equal(summary.body.expense, 403812);

  const monthly = await primary.get('/api/reports/monthly?year=2026').expect(200);
  assert.equal(monthly.body[10].income, 70000);
  assert.equal(monthly.body[10].expense, 403812);
  assert.ok((await primary.get('/api/reports/yearly').expect(200)).body.some(row => row.year === '2026'));

  await primary.put(`/api/transactions/${fx.body.id}`).send(tryTransaction({
    currency_code: 'USD', original_amount: 12_345, amount: 407_385, exchange_rate: '33.0000000000', tcmb_rate: '32.4000000000', rate_source: 'manual', rate_effective_date: '2026-11-02', description: 'USD test gideri güncellendi',
  })).expect(200);
  assert.equal((await primary.get(`/api/transactions/${fx.body.id}/rate-history`).expect(200)).body.length, 2);
  const storedFx = await db.execute('SELECT amount,original_amount,currency_code,exchange_rate FROM transactions WHERE id=? AND user_id=?', [fx.body.id, testUserId]);
  assert.equal(Number(storedFx[0][0].amount), 407_385);
  assert.equal(Number(storedFx[0][0].original_amount), 12_345);
  assert.equal(storedFx[0][0].currency_code, 'USD');
  assert.equal(Number(storedFx[0][0].exchange_rate), 33);

  const edited = await primary.put(`/api/transactions/${expense.body.id}`).send(tryTransaction({ amount: 3000, original_amount: 3000, description: 'Düzenlenmiş MySQL gideri', transaction_date: '2026-11-03' })).expect(200);
  assert.equal(edited.body.amount, 3000);
  await primary.post('/api/transactions').send(tryTransaction({ amount: 0, original_amount: 0 })).expect(400);

  const customCategory = await primary.post('/api/categories').send({ name: 'MySQL test kategorisi', type: 'Expense', color: '#5261ac', icon: 'paw' }).expect(201);
  assert.equal(customCategory.body.icon, 'paw');
  await primary.put(`/api/categories/${customCategory.body.id}/preferred`).send({}).expect(200);
  const preferredCategories = (await primary.get('/api/categories').expect(200)).body;
  assert.equal(preferredCategories.find(category => category.id === customCategory.body.id).is_preferred, 1);
  await primary.post('/api/categories').send({ name: 'MySQL test kategorisi', type: 'Expense' }).expect(409);
  await primary.post('/api/categories').send({ name: 'Geçersiz simge', type: 'Expense', icon: { html: '<script>' } }).expect(400);
  await primary.delete(`/api/categories/${expenseCategory}`).expect(400);
  await primary.put(`/api/categories/${customCategory.body.id}`).send({ name: 'Düzenlenmiş test kategorisi', color: '#5261ac', icon: 'book' }).expect(200);
  const used = await primary.post('/api/transactions').send(tryTransaction({ amount: 120, original_amount: 120, description: 'Kategori FK testi', category_id: customCategory.body.id })).expect(201);
  await primary.delete(`/api/categories/${customCategory.body.id}`).expect(409);

  await primary.put('/api/settings').send({ theme: 'dark' }).expect(200).expect(response => {
    assert.equal(response.body.theme, 'dark');
    assert.equal(response.body.allowDuplicateImports, false);
  });
  await request(app).get('/api/statements').set('Cookie', `denge_session=${otherToken}`).expect(200, []);
  await request(app).get('/api/plans/history').set('Cookie', `denge_session=${otherToken}`).expect(200, []);
  await primary.get('/api/settings').expect(200).expect(response => assert.equal(response.body.theme, 'dark'));
  const stored = await db.execute('SELECT amount FROM transactions WHERE id=? AND user_id=?', [expense.body.id, testUserId]);
  assert.equal(Number(stored[0][0].amount), 3000);

  await primary.delete(`/api/transactions/${used.body.id}`).expect(204);
  await primary.delete(`/api/transactions/${fx.body.id}`).expect(204);
  await primary.delete(`/api/transactions/${expense.body.id}`).expect(204);
  await primary.delete(`/api/transactions/${income.body.id}`).expect(204);
  await primary.delete(`/api/categories/${customCategory.body.id}`).expect(204);
  const restoredPreferred = (await primary.get('/api/categories').expect(200)).body;
  assert.equal(restoredPreferred.find(category => category.id === expenseCategory).is_preferred, 1);
});
