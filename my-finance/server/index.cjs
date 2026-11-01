const express = require('express');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

const app = express();
app.use(express.json({ limit: '32kb' }));
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'finance.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, 'migrations', '001-initial.sql'), 'utf8'));

const defaults = [
  ['Market', 'Expense', '#8b5cf6', 'basket'], ['Ulaşım', 'Expense', '#f59e0b', 'car'], ['Faturalar', 'Expense', '#0ea5e9', 'bolt'],
  ['Sağlık', 'Expense', '#ef4444', 'heart'], ['Alışveriş', 'Expense', '#ec4899', 'bag'], ['Eğlence', 'Expense', '#14b8a6', 'sparkles'],
  ['Eğitim', 'Expense', '#6366f1', 'book'], ['Restoran', 'Expense', '#f97316', 'restaurant'], ['Konut', 'Expense', '#64748b', 'home'], ['Diğer', 'Expense', '#94a3b8', 'circle'],
  ['Maaş', 'Income', '#10b981', 'briefcase'], ['Ek gelir', 'Income', '#22c55e', 'plus'], ['Freelance', 'Income', '#06b6d4', 'laptop'], ['Yatırım', 'Income', '#84cc16', 'chart'], ['Diğer', 'Income', '#94a3b8', 'circle'],
];
const insertCategory = db.prepare('INSERT OR IGNORE INTO categories(name,type,color,icon,is_default) VALUES (?,?,?,?,1)');
db.transaction(() => defaults.forEach((item) => insertCategory.run(...item)))();

const fail = (res, status, message) => res.status(status).json({ error: message });
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function validateTransaction(body) {
  if (!body || !['Income', 'Expense'].includes(body.type)) return 'İşlem türü Income veya Expense olmalı.';
  if (!Number.isSafeInteger(body.amount) || body.amount <= 0) return 'Tutar pozitif kuruş cinsinden tam sayı olmalı.';
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 140) return 'Açıklama 1-140 karakter olmalı.';
  if (!Number.isInteger(body.category_id) || !db.prepare('SELECT id FROM categories WHERE id=? AND type=?').get(body.category_id, body.type)) return 'Geçersiz kategori.';
  if (typeof body.transaction_date !== 'string' || !datePattern.test(body.transaction_date) || Number.isNaN(Date.parse(`${body.transaction_date}T00:00:00Z`)) || new Date(`${body.transaction_date}T00:00:00Z`).toISOString().slice(0, 10) !== body.transaction_date) return 'Tarih YYYY-MM-DD biçiminde geçerli olmalı.';
  return null;
}
const transactionSelect = `SELECT t.id,t.type,t.amount,t.description,t.category_id,t.transaction_date,t.created_at,t.updated_at,c.name AS category,c.color AS category_color,c.icon AS category_icon FROM transactions t JOIN categories c ON c.id=t.category_id`;
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/transactions', (req, res) => {
  const clauses = []; const values = [];
  if (req.query.type && ['Income', 'Expense'].includes(req.query.type)) { clauses.push('t.type=?'); values.push(req.query.type); }
  if (req.query.from && datePattern.test(req.query.from)) { clauses.push('t.transaction_date>=?'); values.push(req.query.from); }
  if (req.query.to && datePattern.test(req.query.to)) { clauses.push('t.transaction_date<=?'); values.push(req.query.to); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  res.json(db.prepare(`${transactionSelect}${where} ORDER BY t.transaction_date DESC,t.id DESC`).all(...values));
});
app.post('/api/transactions', (req, res) => {
  const error = validateTransaction(req.body); if (error) return fail(res, 400, error);
  const result = db.prepare('INSERT INTO transactions(type,amount,description,category_id,transaction_date) VALUES (?,?,?,?,?)').run(req.body.type, req.body.amount, req.body.description.trim(), req.body.category_id, req.body.transaction_date);
  res.status(201).json(db.prepare(`${transactionSelect} WHERE t.id=?`).get(result.lastInsertRowid));
});
app.put('/api/transactions/:id', (req, res) => {
  const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return fail(res, 400, 'Geçersiz işlem kimliği.');
  if (!db.prepare('SELECT id FROM transactions WHERE id=?').get(id)) return fail(res, 404, 'İşlem bulunamadı.');
  const error = validateTransaction(req.body); if (error) return fail(res, 400, error);
  db.prepare('UPDATE transactions SET type=?,amount=?,description=?,category_id=?,transaction_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.type, req.body.amount, req.body.description.trim(), req.body.category_id, req.body.transaction_date, id);
  res.json(db.prepare(`${transactionSelect} WHERE t.id=?`).get(id));
});
app.delete('/api/transactions/:id', (req, res) => { const result = db.prepare('DELETE FROM transactions WHERE id=?').run(Number(req.params.id)); return result.changes ? res.status(204).end() : fail(res, 404, 'İşlem bulunamadı.'); });
app.get('/api/categories', (_req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY type,name').all()));
app.post('/api/categories', (req, res) => {
  const { name, type, color = '#64748b', icon = 'circle' } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 40 || !['Income', 'Expense'].includes(type) || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 400, 'Kategori adı, türü veya rengi geçersiz.');
  try { const result = db.prepare('INSERT INTO categories(name,type,color,icon) VALUES (?,?,?,?)').run(name.trim(), type, color, String(icon).slice(0, 32)); return res.status(201).json(db.prepare('SELECT * FROM categories WHERE id=?').get(result.lastInsertRowid)); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Bu kategori zaten var.'); throw error; }
});
app.put('/api/categories/:id', (req, res) => {
  const id = Number(req.params.id); const current = db.prepare('SELECT * FROM categories WHERE id=?').get(id); if (!current) return fail(res, 404, 'Kategori bulunamadı.');
  const { name, color = current.color, icon = current.icon } = req.body || {};
  if (current.is_default || typeof name !== 'string' || !name.trim() || name.length > 40 || !/^#[0-9a-fA-F]{6}$/.test(color)) return fail(res, 400, 'Varsayılan kategori düzenlenemez veya bilgiler geçersiz.');
  try { db.prepare('UPDATE categories SET name=?,color=?,icon=? WHERE id=?').run(name.trim(), color, String(icon).slice(0, 32), id); return res.json(db.prepare('SELECT * FROM categories WHERE id=?').get(id)); }
  catch (error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'Bu kategori zaten var.'); throw error; }
});
app.delete('/api/categories/:id', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE id=?').get(Number(req.params.id)); if (!category) return fail(res, 404, 'Kategori bulunamadı.');
  if (category.is_default) return fail(res, 400, 'Varsayılan kategori silinemez.');
  try { db.prepare('DELETE FROM categories WHERE id=?').run(category.id); return res.status(204).end(); }
  catch (error) { if (error.code?.startsWith('SQLITE_CONSTRAINT')) return fail(res, 409, 'Bu kategori işlemlerde kullanılıyor.'); throw error; }
});
app.get('/api/dashboard/summary', (_req, res) => {
  const totals = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions").get();
  const monthParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const month = `${monthParts.year}-${monthParts.month}`; const previous = new Date(`${month}-01T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() - 1); const priorMonth = previous.toISOString().slice(0, 7);
  const monthTotals = db.prepare("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE transaction_date LIKE ?");
  const monthly = monthTotals.get(`${month}%`); const prior = monthTotals.get(`${priorMonth}%`);
  const recent = db.prepare(`${transactionSelect} ORDER BY t.transaction_date DESC,t.id DESC LIMIT 6`).all();
  const categories = db.prepare("SELECT c.name,c.color,COALESCE(SUM(t.amount),0) amount FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.type='Expense' AND t.transaction_date LIKE ? WHERE c.type='Expense' GROUP BY c.id HAVING amount>0 ORDER BY amount DESC").all(`${month}%`);
  res.json({ balance: totals.income - totals.expense, income: totals.income, expense: totals.expense, monthIncome: monthly.income, monthExpense: monthly.expense, previousMonthIncome: prior.income, previousMonthExpense: prior.expense, recent, categories });
});
app.get('/api/reports/monthly', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = db.prepare("SELECT strftime('%m',transaction_date) month,COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE strftime('%Y',transaction_date)=? GROUP BY month ORDER BY month").all(String(year));
  const map = new Map(rows.map(row => [Number(row.month), row])); res.json(Array.from({ length: 12 }, (_, i) => map.get(i + 1) || { month: String(i + 1).padStart(2, '0'), income: 0, expense: 0 }));
});
app.get('/api/reports/yearly', (_req, res) => res.json(db.prepare("SELECT strftime('%Y',transaction_date) year,COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions GROUP BY year ORDER BY year DESC").all()));
app.get('/api/settings', (_req, res) => res.json(db.prepare('SELECT currency,theme,language FROM settings WHERE id=1').get()));
app.put('/api/settings', (req, res) => {
  const { currency = 'TRY', theme = 'light', language = 'tr' } = req.body || {};
  if (currency !== 'TRY' || !['light', 'dark'].includes(theme) || language !== 'tr') return fail(res, 400, 'Ayarlar geçersiz.');
  db.prepare('UPDATE settings SET currency=?,theme=?,language=? WHERE id=1').run(currency, theme, language); return res.json(db.prepare('SELECT currency,theme,language FROM settings WHERE id=1').get());
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
