const express = require('express');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyGoogleIdToken } = require('./google-id-token.cjs');

const localEnvPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(localEnvPath)) {
  for (const line of fs.readFileSync(localEnvPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const app = express();
app.use(express.json({ limit: '32kb' }));
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'finance.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, 'migrations', '001-initial.sql'), 'utf8'));

// Upgrade the original single-user tables while preserving old records as unowned rows.
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get()) {
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(fs.readFileSync(path.join(__dirname, 'migrations', '002-user-ownership.sql'), 'utf8'));
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  finally { db.pragma('foreign_keys = ON'); }
}

if (!db.pragma('table_info(categories)').some(column => column.name === 'is_preferred')) {
  const preferredCategoriesMigration = fs.readFileSync(path.join(__dirname, 'migrations', '003-preferred-categories.sql'), 'utf8');
  db.transaction(() => db.exec(preferredCategoriesMigration))();
}

const defaults = [
  ['Market', 'Expense', '#8b5cf6', 'basket'], ['Ulaşım', 'Expense', '#f59e0b', 'car'], ['Faturalar', 'Expense', '#0ea5e9', 'bolt'],
  ['Sağlık', 'Expense', '#ef4444', 'heart'], ['Alışveriş', 'Expense', '#ec4899', 'bag'], ['Eğlence', 'Expense', '#14b8a6', 'sparkles'],
  ['Eğitim', 'Expense', '#6366f1', 'book'], ['Restoran', 'Expense', '#f97316', 'restaurant'], ['Konut', 'Expense', '#64748b', 'home'], ['Diğer', 'Expense', '#94a3b8', 'circle'],
  ['Maaş', 'Income', '#10b981', 'briefcase'], ['Ek gelir', 'Income', '#22c55e', 'plus'], ['Freelance', 'Income', '#06b6d4', 'laptop'], ['Yatırım', 'Income', '#84cc16', 'chart'], ['Diğer', 'Income', '#94a3b8', 'circle'],
];
const insertCategory = db.prepare('INSERT OR IGNORE INTO categories(user_id,name,type,color,icon,is_default) VALUES (?,?,?,?,?,1)');
const ensurePreferredCategory = db.prepare(`
  UPDATE categories
  SET is_preferred=1
  WHERE user_id=? AND type=? AND name=?
    AND NOT EXISTS (
      SELECT 1 FROM categories AS current
      WHERE current.user_id=? AND current.type=? AND current.is_preferred=1
    )
`);

const fail = (res, status, message) => res.status(status).json({ error: message });
const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
const sessionCookieName = 'denge_session';
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const hashSession = token => crypto.createHash('sha256').update(token).digest('hex');
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: sessionLifetimeSeconds * 1000 };
function cookieValue(req, name) {
  const prefix = `${name}=`;
  const value = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return value ? value.slice(prefix.length) : '';
}
function trustedOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true; // Non-browser API clients do not attach ambient cookies cross-site.
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
function requireAuthentication(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  const token = cookieValue(req, sessionCookieName);
  if (!token || token.length > 128) return fail(res, 401, 'Devam etmek için Google hesabınla giriş yap.');
  const session = db.prepare('SELECT u.id,u.google_sub,u.email,u.name,s.expires_at FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(hashSession(token));
  if (!session || session.expires_at <= Math.floor(Date.now() / 1000)) {
    if (session) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hashSession(token));
    res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
    return fail(res, 401, 'Oturum süresi dolmuş. Yeniden giriş yap.');
  }
  req.user = { id: session.id, googleSub: session.google_sub, email: session.email, name: session.name };
  next();
}
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validateTransaction(body, userId) {
  if (!body || !['Income', 'Expense'].includes(body.type)) return 'İşlem türü Income veya Expense olmalı.';
  if (!Number.isSafeInteger(body.amount) || body.amount <= 0) return 'Tutar pozitif kuruş cinsinden tam sayı olmalı.';
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 140) return 'Açıklama 1-140 karakter olmalı.';
  if (!Number.isInteger(body.category_id) || !db.prepare('SELECT id FROM categories WHERE id=? AND user_id=? AND type=?').get(body.category_id, userId, body.type)) return 'Geçersiz kategori.';
  if (typeof body.transaction_date !== 'string' || !datePattern.test(body.transaction_date) || Number.isNaN(Date.parse(`${body.transaction_date}T00:00:00Z`)) || new Date(`${body.transaction_date}T00:00:00Z`).toISOString().slice(0, 10) !== body.transaction_date) return 'Tarih YYYY-MM-DD biçiminde geçerli olmalı.';
  return null;
}
const transactionSelect = `SELECT t.id,t.type,t.amount,t.description,t.category_id,t.transaction_date,t.created_at,t.updated_at,c.name AS category,c.color AS category_color,c.icon AS category_icon FROM transactions t JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id`;
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/auth/config', (_req, res) => res.setHeader('Cache-Control', 'no-store').json({ googleClientId: googleClientId || null }));
app.post('/api/auth/google', sameOriginMutation, async (req, res) => {
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
    let userId;
    try {
      db.transaction(() => {
        const current = db.prepare('SELECT id FROM users WHERE google_sub=?').get(payload.sub);
        if (current) {
          db.prepare('UPDATE users SET email=?,name=? WHERE id=?').run(email, name, current.id);
          userId = current.id;
        } else {
          userId = Number(db.prepare('INSERT INTO users(google_sub,email,name) VALUES (?,?,?)').run(payload.sub, email, name).lastInsertRowid);
        }
        for (const category of defaults) insertCategory.run(userId, ...category);
        ensurePreferredCategory.run(userId, 'Expense', 'Market', userId, 'Expense');
        ensurePreferredCategory.run(userId, 'Income', 'Maaş', userId, 'Income');
        db.prepare("INSERT OR IGNORE INTO settings(user_id,currency,theme,language) VALUES (?,'TRY','light','tr')").run(userId);
        db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(Math.floor(Date.now() / 1000));
        db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(hashSession(token), userId, expiresAt);
      })();
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Bu Google e-posta adresi başka bir hesaba bağlı.');
      throw error;
    }
    res.cookie(sessionCookieName, token, cookieOptions);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ user: db.prepare('SELECT id,email,name FROM users WHERE id=?').get(userId) });
  } catch (error) {
    const networkFailure = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(error.code);
    if (networkFailure || Number(error.response?.status) >= 500) return fail(res, 503, 'Google doğrulama hizmetine şu anda ulaşılamıyor. Biraz sonra yeniden deneyin.');
    if (error.message?.includes('Google account identity')) return fail(res, 401, 'Google hesabı doğrulanamadı.');
    if (error.message?.includes('Google ID token') || error.message?.includes('Wrong recipient') || error.message?.includes('Invalid issuer') || error.message?.includes('Token used')) return fail(res, 401, 'Google giriş bilgisi geçersiz veya süresi dolmuş.');
    console.error('Google token verification failed:', error.message);
    return fail(res, 503, 'Google hesabı şu anda doğrulanamadı. Biraz sonra yeniden deneyin.');
  }
});
app.post('/api/auth/logout', sameOriginMutation, (req, res) => {
  const token = cookieValue(req, sessionCookieName);
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hashSession(token));
  res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.status(204).end();
});
app.use('/api', requireAuthentication, sameOriginMutation);
app.get('/api/auth/me', (req, res) => res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name } }));
app.get('/api/transactions', (req, res) => {
  const clauses = ['t.user_id=?']; const values = [req.user.id];
  if (req.query.type && ['Income', 'Expense'].includes(req.query.type)) { clauses.push('t.type=?'); values.push(req.query.type); }
  if (req.query.from && datePattern.test(req.query.from)) { clauses.push('t.transaction_date>=?'); values.push(req.query.from); }
  if (req.query.to && datePattern.test(req.query.to)) { clauses.push('t.transaction_date<=?'); values.push(req.query.to); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  res.json(db.prepare(`${transactionSelect}${where} ORDER BY t.transaction_date DESC,t.id DESC`).all(...values));
});
app.post('/api/transactions', (req, res) => {
  const error = validateTransaction(req.body, req.user.id); if (error) return fail(res, 400, error);
  const result = db.prepare('INSERT INTO transactions(user_id,type,amount,description,category_id,transaction_date) VALUES (?,?,?,?,?,?)').run(req.user.id, req.body.type, req.body.amount, req.body.description.trim(), req.body.category_id, req.body.transaction_date);
  res.status(201).json(db.prepare(`${transactionSelect} WHERE t.id=? AND t.user_id=?`).get(result.lastInsertRowid, req.user.id));
});
app.put('/api/transactions/:id', (req, res) => {
  const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'Geçersiz işlem kimliği.');
  if (!db.prepare('SELECT id FROM transactions WHERE id=? AND user_id=?').get(id, req.user.id)) return fail(res, 404, 'İşlem bulunamadı.');
  const error = validateTransaction(req.body, req.user.id); if (error) return fail(res, 400, error);
  db.prepare('UPDATE transactions SET type=?,amount=?,description=?,category_id=?,transaction_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(req.body.type, req.body.amount, req.body.description.trim(), req.body.category_id, req.body.transaction_date, id, req.user.id);
  res.json(db.prepare(`${transactionSelect} WHERE t.id=? AND t.user_id=?`).get(id, req.user.id));
});
app.delete('/api/transactions/:id', (req, res) => { const result = db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id); return result.changes ? res.status(204).end() : fail(res, 404, 'İşlem bulunamadı.'); });
app.get('/api/categories', (req, res) => res.json(db.prepare('SELECT * FROM categories WHERE user_id=? ORDER BY type,name').all(req.user.id)));
app.post('/api/categories', (req, res) => {
  const { name, type, color = '#64748b', icon = 'circle' } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 40 || !['Income', 'Expense'].includes(type) || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 400, 'Kategori adı, türü veya rengi geçersiz.');
  try { const result = db.prepare('INSERT INTO categories(user_id,name,type,color,icon) VALUES (?,?,?,?,?)').run(req.user.id, name.trim(), type, color, String(icon).slice(0, 32)); return res.status(201).json(db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(result.lastInsertRowid, req.user.id)); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Bu kategori zaten var.'); throw error; }
});
app.put('/api/categories/:id/preferred', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'Geçersiz kategori kimliği.');
  const category = db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!category) return fail(res, 404, 'Kategori bulunamadı.');

  db.transaction(() => {
    db.prepare('UPDATE categories SET is_preferred=0 WHERE user_id=? AND type=?').run(req.user.id, category.type);
    db.prepare('UPDATE categories SET is_preferred=1 WHERE id=? AND user_id=?').run(id, req.user.id);
  })();
  return res.json(db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(id, req.user.id));
});
app.put('/api/categories/:id', (req, res) => {
  const id = Number(req.params.id); const current = db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(id, req.user.id); if (!current) return fail(res, 404, 'Kategori bulunamadı.');
  const { name, color = current.color, icon = current.icon } = req.body || {};
  if (current.is_default || typeof name !== 'string' || !name.trim() || name.length > 40 || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 400, 'Varsayılan kategori düzenlenemez veya bilgiler geçersiz.');
  try { db.prepare('UPDATE categories SET name=?,color=?,icon=? WHERE id=? AND user_id=?').run(name.trim(), color, String(icon).slice(0, 32), id, req.user.id); return res.json(db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(id, req.user.id)); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Bu kategori zaten var.'); throw error; }
});
app.delete('/api/categories/:id', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id); if (!category) return fail(res, 404, 'Kategori bulunamadı.');
  if (category.is_default) return fail(res, 400, 'Varsayılan kategori silinemez.');
  try { db.prepare('DELETE FROM categories WHERE id=? AND user_id=?').run(category.id, req.user.id); return res.status(204).end(); }
  catch (error) { if (error.code?.startsWith('SQLITE_CONSTRAINT')) return fail(res, 409, 'Bu kategori işlemlerde kullanılıyor.'); throw error; }
});
app.get('/api/dashboard/summary', (req, res) => {
  const totals = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=?").get(req.user.id);
  const monthParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const month = `${monthParts.year}-${monthParts.month}`; const previous = new Date(`${month}-01T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() - 1); const priorMonth = previous.toISOString().slice(0, 7);
  const monthTotals = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND transaction_date LIKE ?");
  const monthly = monthTotals.get(req.user.id, `${month}%`); const prior = monthTotals.get(req.user.id, `${priorMonth}%`);
  const recent = db.prepare(`${transactionSelect} WHERE t.user_id=? ORDER BY t.transaction_date DESC,t.id DESC LIMIT 6`).all(req.user.id);
  const categories = db.prepare("SELECT c.name,c.color,COALESCE(SUM(t.amount),0) amount FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.user_id=c.user_id AND t.type='Expense' AND t.transaction_date LIKE ? WHERE c.user_id=? AND c.type='Expense' GROUP BY c.id HAVING amount>0 ORDER BY amount DESC").all(`${month}%`, req.user.id);
  res.json({ balance: totals.income - totals.expense, income: totals.income, expense: totals.expense, monthIncome: monthly.income, monthExpense: monthly.expense, previousMonthIncome: prior.income, previousMonthExpense: prior.expense, recent, categories });
});
app.get('/api/reports/monthly', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = db.prepare("SELECT strftime('%m',transaction_date) month,COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND strftime('%Y',transaction_date)=? GROUP BY month ORDER BY month").all(req.user.id, String(year));
  const map = new Map(rows.map(row => [Number(row.month), row])); res.json(Array.from({ length: 12 }, (_, i) => map.get(i + 1) || { month: String(i + 1).padStart(2, '0'), income: 0, expense: 0 }));
});
app.get('/api/reports/yearly', (req, res) => res.json(db.prepare("SELECT strftime('%Y',transaction_date) year,COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? GROUP BY year ORDER BY year DESC").all(req.user.id)));
app.get('/api/settings', (req, res) => res.json(db.prepare('SELECT currency,theme,language FROM settings WHERE user_id=?').get(req.user.id)));
app.put('/api/settings', (req, res) => {
  const { currency = 'TRY', theme = 'light', language = 'tr' } = req.body || {};
  if (currency !== 'TRY' || !['light', 'dark'].includes(theme) || language !== 'tr') return fail(res, 400, 'Ayarlar geçersiz.');
  db.prepare('UPDATE settings SET currency=?,theme=?,language=? WHERE user_id=?').run(currency, theme, language, req.user.id); return res.json(db.prepare('SELECT currency,theme,language FROM settings WHERE user_id=?').get(req.user.id));
});
app.use('/api', (_req, res) => fail(res, 404, 'API endpoint bulunamadı.'));
app.use((error, _req, res, _next) => { console.error(error); res.status(error.status || 500).json({ error: error.status === 400 ? 'İstek gövdesi geçersiz JSON içeriyor.' : 'Beklenmeyen sunucu hatası.' }); });
const browserPath = path.join(__dirname, '..', 'dist', 'my-finance', 'browser');
if (fs.existsSync(browserPath)) {
  app.use(express.static(browserPath, { maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(browserPath, 'index.html')));
}

if (require.main === module) { const port = Number(process.env.PORT) || 3000; app.listen(port, () => console.log(`Denge API http://localhost:${port}`)); }
module.exports = { app, db };
