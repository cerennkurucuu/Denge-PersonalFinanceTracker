const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyGoogleIdToken } = require('./google-id-token.cjs');

const app = express();
app.use(express.json({ limit: '32kb' }));

const mysqlOptions = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  timezone: 'Z',
};

if (String(process.env.MYSQL_SSL || '').toLowerCase() === 'true') {
  mysqlOptions.ssl = { rejectUnauthorized: true };
  if (process.env.MYSQL_SSL_CA) mysqlOptions.ssl.ca = fs.readFileSync(path.resolve(process.env.MYSQL_SSL_CA), 'utf8');
}

const db = mysql.createPool(mysqlOptions);
const defaults = [
  ['Market', 'Expense', '#8b5cf6', 'basket'], ['Ulaşım', 'Expense', '#f59e0b', 'car'], ['Faturalar', 'Expense', '#0ea5e9', 'bolt'],
  ['Sağlık', 'Expense', '#ef4444', 'heart'], ['Alışveriş', 'Expense', '#ec4899', 'bag'], ['Eğlence', 'Expense', '#14b8a6', 'sparkles'],
  ['Eğitim', 'Expense', '#6366f1', 'book'], ['Restoran', 'Expense', '#f97316', 'restaurant'], ['Konut', 'Expense', '#64748b', 'home'], ['Diğer', 'Expense', '#94a3b8', 'circle'],
  ['Maaş', 'Income', '#10b981', 'briefcase'], ['Ek gelir', 'Income', '#22c55e', 'plus'], ['Freelance', 'Income', '#06b6d4', 'laptop'], ['Yatırım', 'Income', '#84cc16', 'chart'], ['Diğer', 'Income', '#94a3b8', 'circle'],
];
const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
const sessionCookieName = 'denge_session';
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const hashSession = token => crypto.createHash('sha256').update(token).digest('hex');
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: sessionLifetimeSeconds * 1000 };
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const transactionSelect = `SELECT t.id,t.type,t.amount,t.description,t.category_id,t.transaction_date,t.created_at,t.updated_at,c.name AS category,c.color AS category_color,c.icon AS category_icon FROM transactions t JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id`;
const fail = (res, status, message) => res.status(status).json({ error: message });
const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function cookieValue(req, name) {
  const prefix = `${name}=`;
  const value = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return value ? value.slice(prefix.length) : '';
}

function trustedOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (process.env.APP_ORIGIN) return origin === process.env.APP_ORIGIN;
    const requestHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (requestHost && parsed.host.toLowerCase() === requestHost.toLowerCase()) return true;
    return process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(parsed.hostname) && /^42\d\d$/.test(parsed.port);
  } catch { return false; }
}

function sameOriginMutation(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !trustedOrigin(req)) return fail(res, 403, 'Bu kaynağa ait olmayan istek reddedildi.');
  next();
}

async function get(sql, values = [], connection = db) {
  const [rows] = await connection.execute(sql, values);
  return rows[0];
}

async function all(sql, values = [], connection = db) {
  const [rows] = await connection.execute(sql, values);
  return rows;
}

async function run(sql, values = [], connection = db) {
  const [result] = await connection.execute(sql, values);
  return result;
}

function asNumbers(row, fields) {
  if (!row) return row;
  const normalized = { ...row };
  for (const field of fields) if (normalized[field] !== null && normalized[field] !== undefined) normalized[field] = Number(normalized[field]);
  return normalized;
}

function rowsAsNumbers(rows, fields) {
  return rows.map(row => asNumbers(row, fields));
}

async function withTransaction(callback) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function requireAuthentication(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  const token = cookieValue(req, sessionCookieName);
  if (!token || token.length > 128) return fail(res, 401, 'Devam etmek için Google hesabınla giriş yap.');
  try {
    const session = await get('SELECT u.id,u.google_sub,u.email,u.name,s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?', [hashSession(token)]);
    if (!session || Number(session.expires_at) <= Math.floor(Date.now() / 1000)) {
      if (session) await run('DELETE FROM auth_sessions WHERE token_hash=?', [hashSession(token)]);
      res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
      return fail(res, 401, 'Oturum süresi dolmuş. Yeniden giriş yap.');
    }
    req.user = { id: Number(session.id), googleSub: session.google_sub, email: session.email, name: session.name };
    return next();
  } catch (error) { return next(error); }
}

async function validateTransaction(body, userId) {
  if (!body || !['Income', 'Expense'].includes(body.type)) return 'İşlem türü Income veya Expense olmalı.';
  if (!Number.isSafeInteger(body.amount) || body.amount <= 0) return 'Tutar pozitif kuruş cinsinden tam sayı olmalı.';
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 140) return 'Açıklama 1-140 karakter olmalı.';
  if (!Number.isInteger(body.category_id) || !await get('SELECT id FROM categories WHERE id=? AND user_id=? AND type=?', [body.category_id, userId, body.type])) return 'Geçersiz kategori.';
  if (typeof body.transaction_date !== 'string' || !datePattern.test(body.transaction_date) || Number.isNaN(Date.parse(`${body.transaction_date}T00:00:00Z`)) || new Date(`${body.transaction_date}T00:00:00Z`).toISOString().slice(0, 10) !== body.transaction_date) return 'Tarih YYYY-MM-DD biçiminde geçerli olmalı.';
  return null;
}

async function migrate() {
  const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Missing MySQL configuration: ${missing.join(', ')}`);
  if (process.env.NODE_ENV === 'production' && mysqlOptions.ssl === undefined) throw new Error('MySQL TLS must be enabled in production.');
  await db.query('SELECT 1');
  const migrationSql = fs.readFileSync(path.join(__dirname, 'migrations', 'mysql', '001-initial.sql'), 'utf8');
  for (const statement of migrationSql.split(/;\s*(?:\r?\n|$)/).map(item => item.trim()).filter(Boolean)) await db.query(statement);
  await run('INSERT IGNORE INTO schema_migrations(version) VALUES (?)', ['001-initial']);
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: 'mysql' }));
app.get('/api/auth/config', (_req, res) => res.setHeader('Cache-Control', 'no-store').json({ googleClientId: googleClientId || null }));

app.post('/api/auth/google', sameOriginMutation, route(async (req, res) => {
  if (!googleClientId) return fail(res, 503, 'Google girişi henüz yapılandırılmadı. OAuth Web Client ID gerekli.');
  const credential = req.body?.credential;
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 8192) return fail(res, 400, 'Google kimlik bilgisi geçersiz.');
  try {
    const payload = await verifyGoogleIdToken(credential, googleClientId);
    if (!payload?.sub || !payload.email || payload.email_verified !== true) return fail(res, 401, 'Google hesabı doğrulanamadı.');
    const email = payload.email.toLowerCase();
    const name = String(payload.name || payload.given_name || email).slice(0, 120);
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + sessionLifetimeSeconds;
    const userId = await withTransaction(async connection => {
      let current = await get('SELECT id FROM users WHERE google_sub=? FOR UPDATE', [payload.sub], connection);
      let id;
      if (current) {
        id = Number(current.id);
        await run('UPDATE users SET email=?,name=? WHERE id=?', [email, name, id], connection);
      } else {
        const inserted = await run('INSERT INTO users(google_sub,email,name) VALUES (?,?,?)', [payload.sub, email, name], connection);
        id = Number(inserted.insertId);
      }
      for (const category of defaults) await run('INSERT IGNORE INTO categories(user_id,name,type,color,icon,is_default) VALUES (?,?,?,?,?,1)', [id, ...category], connection);
      for (const type of ['Expense', 'Income']) {
        const defaultName = type === 'Expense' ? 'Market' : 'Maaş';
        await run(`UPDATE categories SET is_preferred=1 WHERE user_id=? AND type=? AND name=? AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM categories WHERE user_id=? AND type=? AND is_preferred=1) AS preferred)`, [id, type, defaultName, id, type], connection);
      }
      await run("INSERT IGNORE INTO settings(user_id,currency,theme,language) VALUES (?,'TRY','light','tr')", [id], connection);
      await run('DELETE FROM auth_sessions WHERE expires_at<=?', [Math.floor(Date.now() / 1000)], connection);
      await run('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)', [hashSession(token), id, expiresAt], connection);
      return id;
    });
    res.cookie(sessionCookieName, token, cookieOptions);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ user: asNumbers(await get('SELECT id,email,name FROM users WHERE id=?', [userId]), ['id']) });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Bu Google e-posta adresi başka bir hesaba bağlı.');
    const networkFailure = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(error.code);
    if (networkFailure || Number(error.response?.status) >= 500) return fail(res, 503, 'Google doğrulama hizmetine şu anda ulaşılamıyor. Biraz sonra yeniden deneyin.');
    if (error.message?.includes('Google account identity')) return fail(res, 401, 'Google hesabı doğrulanamadı.');
    if (error.message?.includes('Google ID token') || error.message?.includes('Wrong recipient') || error.message?.includes('Invalid issuer') || error.message?.includes('Token used')) return fail(res, 401, 'Google giriş bilgisi geçersiz veya süresi dolmuş.');
    throw error;
  }
}));

app.post('/api/auth/logout', sameOriginMutation, route(async (req, res) => {
  const token = cookieValue(req, sessionCookieName);
  if (token) await run('DELETE FROM auth_sessions WHERE token_hash=?', [hashSession(token)]);
  res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  return res.status(204).end();
}));

app.use('/api', requireAuthentication, sameOriginMutation);
app.get('/api/auth/me', (req, res) => res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name } }));

app.get('/api/transactions', route(async (req, res) => {
  const clauses = ['t.user_id=?']; const values = [req.user.id];
  if (req.query.type && ['Income', 'Expense'].includes(req.query.type)) { clauses.push('t.type=?'); values.push(req.query.type); }
  if (req.query.from && datePattern.test(req.query.from)) { clauses.push('t.transaction_date>=?'); values.push(req.query.from); }
  if (req.query.to && datePattern.test(req.query.to)) { clauses.push('t.transaction_date<=?'); values.push(req.query.to); }
  return res.json(rowsAsNumbers(await all(`${transactionSelect} WHERE ${clauses.join(' AND ')} ORDER BY t.transaction_date DESC,t.id DESC`, values), ['id', 'amount', 'category_id']));
}));

app.post('/api/transactions', route(async (req, res) => {
  const error = await validateTransaction(req.body, req.user.id); if (error) return fail(res, 400, error);
  const result = await run('INSERT INTO transactions(user_id,type,amount,description,category_id,transaction_date) VALUES (?,?,?,?,?,?)', [req.user.id, req.body.type, req.body.amount, req.body.description.trim(), req.body.category_id, req.body.transaction_date]);
  return res.status(201).json(asNumbers(await get(`${transactionSelect} WHERE t.id=? AND t.user_id=?`, [Number(result.insertId), req.user.id]), ['id', 'amount', 'category_id']));
}));

app.put('/api/transactions/:id', route(async (req, res) => {
  const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'Geçersiz işlem kimliği.');
  if (!await get('SELECT id FROM transactions WHERE id=? AND user_id=?', [id, req.user.id])) return fail(res, 404, 'İşlem bulunamadı.');
  const error = await validateTransaction(req.body, req.user.id); if (error) return fail(res, 400, error);
  await run('UPDATE transactions SET type=?,amount=?,description=?,category_id=?,transaction_date=? WHERE id=? AND user_id=?', [req.body.type, req.body.amount, req.body.description.trim(), req.body.category_id, req.body.transaction_date, id, req.user.id]);
  return res.json(asNumbers(await get(`${transactionSelect} WHERE t.id=? AND t.user_id=?`, [id, req.user.id]), ['id', 'amount', 'category_id']));
}));

app.delete('/api/transactions/:id', route(async (req, res) => {
  const result = await run('DELETE FROM transactions WHERE id=? AND user_id=?', [Number(req.params.id), req.user.id]);
  return result.affectedRows ? res.status(204).end() : fail(res, 404, 'İşlem bulunamadı.');
}));

app.get('/api/categories', route(async (req, res) => res.json(rowsAsNumbers(await all('SELECT * FROM categories WHERE user_id=? ORDER BY type,name', [req.user.id]), ['id', 'user_id', 'is_default', 'is_preferred']))));
app.post('/api/categories', route(async (req, res) => {
  const { name, type, color = '#64748b', icon = 'circle' } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 40 || !['Income', 'Expense'].includes(type) || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 400, 'Kategori adı, türü veya rengi geçersiz.');
  try {
    const result = await run('INSERT INTO categories(user_id,name,type,color,icon) VALUES (?,?,?,?,?)', [req.user.id, name.trim(), type, color, String(icon).slice(0, 32)]);
    return res.status(201).json(asNumbers(await get('SELECT * FROM categories WHERE id=? AND user_id=?', [Number(result.insertId), req.user.id]), ['id', 'user_id', 'is_default', 'is_preferred']));
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Bu kategori zaten var.'); throw error; }
}));
app.put('/api/categories/:id/preferred', route(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'Geçersiz kategori kimliği.');
  const category = await get('SELECT * FROM categories WHERE id=? AND user_id=?', [id, req.user.id]);
  if (!category) return fail(res, 404, 'Kategori bulunamadı.');
  await withTransaction(async connection => {
    await all('SELECT id FROM categories WHERE user_id=? AND type=? FOR UPDATE', [req.user.id, category.type], connection);
    await run('UPDATE categories SET is_preferred=0 WHERE user_id=? AND type=?', [req.user.id, category.type], connection);
    await run('UPDATE categories SET is_preferred=1 WHERE id=? AND user_id=?', [id, req.user.id], connection);
  });
  return res.json(asNumbers(await get('SELECT * FROM categories WHERE id=? AND user_id=?', [id, req.user.id]), ['id', 'user_id', 'is_default', 'is_preferred']));
}));
app.put('/api/categories/:id', route(async (req, res) => {
  const id = Number(req.params.id); const current = await get('SELECT * FROM categories WHERE id=? AND user_id=?', [id, req.user.id]);
  if (!current) return fail(res, 404, 'Kategori bulunamadı.');
  const { name, color = current.color, icon = current.icon } = req.body || {};
  if (current.is_default || typeof name !== 'string' || !name.trim() || name.length > 40 || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 400, 'Varsayılan kategori düzenlenemez veya bilgiler geçersiz.');
  try {
    await run('UPDATE categories SET name=?,color=?,icon=? WHERE id=? AND user_id=?', [name.trim(), color, String(icon).slice(0, 32), id, req.user.id]);
    return res.json(asNumbers(await get('SELECT * FROM categories WHERE id=? AND user_id=?', [id, req.user.id]), ['id', 'user_id', 'is_default', 'is_preferred']));
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Bu kategori zaten var.'); throw error; }
}));
app.delete('/api/categories/:id', route(async (req, res) => {
  const category = await get('SELECT * FROM categories WHERE id=? AND user_id=?', [Number(req.params.id), req.user.id]);
  if (!category) return fail(res, 404, 'Kategori bulunamadı.');
  if (category.is_default) return fail(res, 400, 'Varsayılan kategori silinemez.');
  try {
    await run('DELETE FROM categories WHERE id=? AND user_id=?', [category.id, req.user.id]);
    return res.status(204).end();
  } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') return fail(res, 409, 'Bu kategori işlemlerde kullanılıyor.'); throw error; }
}));

app.get('/api/dashboard/summary', route(async (req, res) => {
  const totals = await get("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=?", [req.user.id]);
  const monthParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const month = `${monthParts.year}-${monthParts.month}`; const previous = new Date(`${month}-01T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() - 1); const priorMonth = previous.toISOString().slice(0, 7);
  const monthly = await get("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND DATE_FORMAT(transaction_date,'%Y-%m')=?", [req.user.id, month]);
  const prior = await get("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND DATE_FORMAT(transaction_date,'%Y-%m')=?", [req.user.id, priorMonth]);
  const recent = rowsAsNumbers(await all(`${transactionSelect} WHERE t.user_id=? ORDER BY t.transaction_date DESC,t.id DESC LIMIT 6`, [req.user.id]), ['id', 'amount', 'category_id']);
  const categories = rowsAsNumbers(await all("SELECT c.name,c.color,COALESCE(SUM(t.amount),0) amount FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.user_id=c.user_id AND t.type='Expense' AND DATE_FORMAT(t.transaction_date,'%Y-%m')=? WHERE c.user_id=? AND c.type='Expense' GROUP BY c.id HAVING amount>0 ORDER BY amount DESC", [month, req.user.id]), ['amount']);
  return res.json({ balance: Number(totals.income) - Number(totals.expense), income: Number(totals.income), expense: Number(totals.expense), monthIncome: Number(monthly.income), monthExpense: Number(monthly.expense), previousMonthIncome: Number(prior.income), previousMonthExpense: Number(prior.expense), recent, categories });
}));

app.get('/api/reports/monthly', route(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = await all("SELECT LPAD(MONTH(transaction_date),2,'0') month,COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND YEAR(transaction_date)=? GROUP BY MONTH(transaction_date) ORDER BY MONTH(transaction_date)", [req.user.id, year]);
  const map = new Map(rows.map(row => [Number(row.month), row]));
  return res.json(Array.from({ length: 12 }, (_, index) => asNumbers(map.get(index + 1) || { month: String(index + 1).padStart(2, '0'), income: 0, expense: 0 }, ['income', 'expense'])));
}));
app.get('/api/reports/yearly', route(async (req, res) => res.json(rowsAsNumbers(await all("SELECT CAST(YEAR(transaction_date) AS CHAR) year,COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? GROUP BY YEAR(transaction_date) ORDER BY YEAR(transaction_date) DESC", [req.user.id]), ['income', 'expense']))));
app.get('/api/settings', route(async (req, res) => res.json(await get('SELECT currency,theme,language FROM settings WHERE user_id=?', [req.user.id]))));
app.put('/api/settings', route(async (req, res) => {
  const { currency = 'TRY', theme = 'light', language = 'tr' } = req.body || {};
  if (currency !== 'TRY' || !['light', 'dark'].includes(theme) || language !== 'tr') return fail(res, 400, 'Ayarlar geçersiz.');
  await run('UPDATE settings SET currency=?,theme=?,language=? WHERE user_id=?', [currency, theme, language, req.user.id]);
  return res.json(await get('SELECT currency,theme,language FROM settings WHERE user_id=?', [req.user.id]));
}));
app.use('/api', (_req, res) => fail(res, 404, 'API endpoint bulunamadı.'));
app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.code || 'UNKNOWN');
  return res.status(error.status || 500).json({ error: error.status === 400 ? 'İstek gövdesi geçersiz JSON içeriyor.' : 'Beklenmeyen sunucu hatası.' });
});

const browserPath = path.join(__dirname, '..', 'dist', 'my-finance', 'browser');
if (fs.existsSync(browserPath)) {
  app.use(express.static(browserPath, { maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(browserPath, 'index.html')));
}

async function start() {
  try {
    await migrate();
    const port = Number(process.env.PORT) || 3000;
    const server = app.listen(port, () => console.log(`Denge API (MySQL) http://localhost:${port}`));
    return server;
  } catch (error) {
    console.error('MySQL initialization failed:', error.code || error.message);
    process.exitCode = 1;
    await db.end();
    return null;
  }
}

module.exports = { app, db, migrate, start };
