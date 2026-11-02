const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyGoogleIdToken } = require('./google-id-token.cjs');
const { isTrustedOrigin, normalizeAppOrigin, parseTrustedProxyHops, validateProductionConfiguration } = require('./security-config.cjs');

const production = process.env.NODE_ENV === 'production';
const appOrigin = normalizeAppOrigin(process.env.APP_ORIGIN, { production });
const trustedProxyHops = parseTrustedProxyHops(process.env.TRUST_PROXY_HOPS);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', trustedProxyHops);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
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
  ['Market', 'Expense', '#35644c', 'basket'], ['Ulaşım', 'Expense', '#bd8a40', 'car'], ['Faturalar', 'Expense', '#56818a', 'bolt'],
  ['Sağlık', 'Expense', '#b65d4f', 'heart'], ['Alışveriş', 'Expense', '#a96e76', 'bag'], ['Eğlence', 'Expense', '#658172', 'sparkles'],
  ['Eğitim', 'Expense', '#697b9c', 'book'], ['Restoran', 'Expense', '#c87855', 'restaurant'], ['Konut', 'Expense', '#747f78', 'home'], ['Diğer', 'Expense', '#89938d', 'circle'],
  ['Maaş', 'Income', '#4f8b69', 'briefcase'], ['Ek gelir', 'Income', '#5e9b77', 'plus'], ['Freelance', 'Income', '#497d82', 'laptop'], ['Yatırım', 'Income', '#648a46', 'chart'], ['Diğer', 'Income', '#89938d', 'circle'],
];
const categoryIcons = new Set(['circle', 'basket', 'car', 'bolt', 'heart', 'bag', 'sparkles', 'book', 'restaurant', 'home', 'briefcase', 'plus', 'laptop', 'chart', 'paw']);
const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
const sessionCookieName = 'denge_session';
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const hashSession = token => crypto.createHash('sha256').update(token).digest('hex');
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: sessionLifetimeSeconds * 1000 };
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const transactionSelect = `SELECT t.id,t.type,t.amount,t.original_amount,t.currency_code,t.exchange_rate,t.tcmb_rate,t.rate_source,t.rate_effective_date,t.description,t.category_id,t.transaction_date,t.created_at,t.updated_at,c.name AS category,c.color AS category_color,c.icon AS category_icon FROM transactions t JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id`;
const fail = (res, status, message) => res.status(status).json({ error: message });
const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
function localToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function isValidDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function positiveId(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cookieValue(req, name) {
  const prefix = `${name}=`;
  const value = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return value ? value.slice(prefix.length) : '';
}

function sameOriginMutation(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isTrustedOrigin({ origin: req.get('origin'), host: req.get('host') }, { appOrigin, production })) {
    return fail(res, 403, 'Bu kaynağa ait olmayan istek reddedildi.');
  }
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

async function isAppliedMigrationStep(statement, error) {
  if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME', 'ER_CANT_DROP_FIELD_OR_KEY', 'ER_CANT_CREATE_TABLE'].includes(error.code)) return false;

  const table = /^ALTER\s+TABLE\s+`?([a-z0-9_]+)`?\s+/i.exec(statement)?.[1];
  if (!table) return false;
  const column = /^ALTER\s+TABLE\s+`?[a-z0-9_]+`?\s+ADD\s+COLUMN\s+`?([a-z0-9_]+)`?/i.exec(statement)?.[1];
  if (column) {
    return Boolean(await get(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
      [table, column],
    ));
  }

  const index = /^ALTER\s+TABLE\s+`?[a-z0-9_]+`?\s+ADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\s+`?([a-z0-9_]+)`?/i.exec(statement)?.[1];
  if (index) {
    return Boolean(await get(
      'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',
      [table, index],
    ));
  }

  const addedConstraint = /^ALTER\s+TABLE\s+`?[a-z0-9_]+`?\s+ADD\s+CONSTRAINT\s+`?([a-z0-9_]+)`?/i.exec(statement)?.[1];
  const droppedConstraint = /^ALTER\s+TABLE\s+`?[a-z0-9_]+`?\s+DROP\s+FOREIGN\s+KEY\s+`?([a-z0-9_]+)`?/i.exec(statement)?.[1];
  const constraint = addedConstraint || droppedConstraint;
  if (constraint) {
    const exists = await get(
      'SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=? AND CONSTRAINT_TYPE=\'FOREIGN KEY\'',
      [table, constraint],
    );
    return addedConstraint ? Boolean(exists) : !exists;
  }

  return false;
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
  if (!isValidDate(body.transaction_date)) return 'Tarih YYYY-MM-DD biçiminde geçerli olmalı.';
  if (!Number.isSafeInteger(body.amount) || body.amount <= 0 || !Number.isSafeInteger(body.original_amount) || body.original_amount <= 0) return 'Tutar pozitif kuruş cinsinden tam sayı olmalı.';
  if (!/^[A-Z]{3}$/.test(body.currency_code || '') || !Number.isFinite(Number(body.exchange_rate)) || Number(body.exchange_rate) <= 0 || Number(body.exchange_rate) > 1_000_000) return 'Para birimi veya döviz kuru geçersiz.';
  if (body.currency_code === 'TRY' && (body.rate_source !== 'TRY' || body.exchange_rate !== 1 || body.amount !== body.original_amount)) return 'TRY işlemlerinde kur 1 olmalı.';
  if (body.currency_code !== 'TRY' && !['TCMB', 'manual'].includes(body.rate_source)) return 'Dövizli işlem kur kaynağı geçersiz.';
  if (body.rate_source !== 'TRY' && !isValidDate(body.rate_effective_date)) return 'Kur tarihi geçersiz.';
  if (body.rate_source !== 'TRY' && body.rate_effective_date > body.transaction_date) return 'Kur tarihi işlem tarihinden sonra olamaz.';
  if (body.tcmb_rate !== null && body.tcmb_rate !== undefined && (!Number.isFinite(Number(body.tcmb_rate)) || Number(body.tcmb_rate) <= 0)) return 'TCMB referans kuru geçersiz.';
  if (body.currency_code !== 'TRY' && body.rate_source === 'TCMB') {
    try {
      const official = await getTcmbRate(body.currency_code, body.transaction_date);
      if (!matchesTcmbQuote(body, official)) return 'Kaydedilen TCMB kuru veya referans değeri güncel değil. Kuru yenileyip tekrar deneyin.';
    } catch { return 'TCMB kuru doğrulanamadı. Kuru elle düzenleyerek kaydedebilirsin.'; }
  }
  if (calculateTryMinor(body.original_amount, body.exchange_rate, body.currency_code) !== body.amount) return 'TL karşılığı, tutar ve kura göre hesaplanan değerle eşleşmiyor.';
  if (typeof body.description !== 'string' || !body.description.trim() || body.description.length > 140) return 'Açıklama 1-140 karakter olmalı.';
  if (!Number.isInteger(body.category_id) || !await get('SELECT id FROM categories WHERE id=? AND user_id=? AND type=?', [body.category_id, userId, body.type])) return 'Geçersiz kategori.';
  return null;
}

async function migrate() {
  const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Missing MySQL configuration: ${missing.join(', ')}`);
  validateProductionConfiguration({ production, appOrigin, googleClientId, mysqlTls: mysqlOptions.ssl !== undefined });
  await db.query('SELECT 1');
  const [lockRows] = await db.query("SELECT GET_LOCK('denge-schema-migrations', 30) AS acquired");
  if (Number(lockRows[0]?.acquired) !== 1) throw new Error('Could not acquire database migration lock.');
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const folder = path.join(__dirname, 'migrations', 'mysql');
    const files = fs.readdirSync(folder).filter(file => /^\d{3}-[a-z0-9-]+\.sql$/i.test(file)).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/i, '');
      if (await get('SELECT version FROM schema_migrations WHERE version=?', [version])) continue;
      if (version === '003-tenant-foreign-keys') {
        const unownedRecord = await get('SELECT id FROM categories WHERE user_id IS NULL UNION ALL SELECT id FROM transactions WHERE user_id IS NULL UNION ALL SELECT id FROM settings WHERE user_id IS NULL LIMIT 1');
        const mismatchedTransaction = await get('SELECT t.id FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.user_id IS NOT NULL AND (c.user_id IS NULL OR t.user_id<>c.user_id) LIMIT 1');
        const mismatchedRateLog = await get('SELECT r.id FROM exchange_rate_logs r JOIN transactions t ON t.id=r.transaction_id WHERE t.user_id IS NULL OR r.user_id<>t.user_id LIMIT 1');
        if (unownedRecord) throw new Error('Tenant foreign-key migration stopped because existing financial records do not have an owner.');
        if (mismatchedTransaction || mismatchedRateLog) throw new Error('Tenant foreign-key migration stopped because existing records have mismatched user ownership.');
      }
      const sql = fs.readFileSync(path.join(folder, file), 'utf8');
      try {
        for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map(item => item.trim()).filter(Boolean)) {
          try {
            await db.query(statement);
          } catch (error) {
            if (!await isAppliedMigrationStep(statement, error)) throw error;
          }
        }
        await run('INSERT INTO schema_migrations(version) VALUES (?)', [version]);
      } catch (error) {
        error.message = `Migration ${version} failed: ${error.message}`;
        throw error;
      }
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('denge-schema-migrations')");
  }
}

const rateCache = new Map();
const rateRequests = new Map();
const tcmbCurrencyFallback = ['AED','AUD','AZN','BGN','CAD','CHF','CNY','DKK','EUR','GBP','IRR','JPY','KWD','NOK','PKR','QAR','RON','RUB','SAR','SEK','USD'];
function xmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return match?.[1]?.trim() || '';
}
function parseTcmbRates(xml) {
  const rates = new Map();
  const effectiveDate = xml.match(/<Tarih_Date[^>]*Tarih="(\d{2})\.(\d{2})\.(\d{4})"/i);
  const rateDate = effectiveDate ? `${effectiveDate[3]}-${effectiveDate[2]}-${effectiveDate[1]}` : '';
  for (const block of xml.match(/<Currency\b[^>]*>[\s\S]*?<\/Currency>/gi) || []) {
    const code = block.match(/\bCurrencyCode="([A-Z]{3})"/i)?.[1]?.toUpperCase();
    const unit = Number(xmlValue(block, 'Unit'));
    const banknoteBuying = Number(xmlValue(block, 'BanknoteBuying'));
    if (code && Number.isFinite(unit) && unit > 0 && Number.isFinite(banknoteBuying) && banknoteBuying > 0) {
      rates.set(code, { currency: code, rate: banknoteBuying / unit, unit, effectiveDate: rateDate, source: 'TCMB', basis: 'Efektif alış' });
    }
  }
  return { rates, effectiveDate: rateDate };
}
function calculateTryMinor(originalMinor, rate, currency = 'TRY') {
  const text = String(rate);
  if (!/^\d+(?:\.\d{1,10})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const scale = 10n ** 10n;
  const scaledRate = BigInt(whole) * scale + BigInt(fraction.padEnd(10, '0'));
  let currencyDigits = 2;
  try { currencyDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits; } catch { return null; }
  const denominator = scale * 10n ** BigInt(currencyDigits);
  const converted = (BigInt(originalMinor) * scaledRate * 100n + denominator / 2n) / denominator;
  const result = Number(converted);
  return Number.isSafeInteger(result) ? result : null;
}
function matchesTcmbQuote(body, official) {
  if (body?.tcmb_rate === null || body?.tcmb_rate === undefined || !Number.isFinite(Number(body.tcmb_rate))) return false;
  const expected = Number(Number(official.rate).toFixed(10));
  return Number(Number(body.exchange_rate).toFixed(10)) === expected
    && Number(Number(body.tcmb_rate).toFixed(10)) === expected
    && body.rate_effective_date === official.effectiveDate;
}
async function fetchTcmbXml(url, fetchImpl = fetch) {
  const cached = rateCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.body;
  const pending = rateRequests.get(url);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/xml,text/xml' } });
    if (!response.ok) throw new Error(`TCMB returned ${response.status}`);
    const body = await response.text();
    if (!body.includes('<Tarih_Date')) throw new Error('TCMB returned an invalid rate document');
    if (rateCache.size >= 64) rateCache.delete(rateCache.keys().next().value);
    const cacheDuration = url.endsWith('/today.xml') ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
    rateCache.set(url, { body, expiresAt: Date.now() + cacheDuration });
    return body;
  })();
  rateRequests.set(url, request);
  try { return await request; }
  finally { if (rateRequests.get(url) === request) rateRequests.delete(url); }
}
async function getTcmbRate(currency, requestedDate, fetchXml = fetchTcmbXml) {
  const [year, month, day] = requestedDate.split('-').map(Number);
  const today = localToday();
  const previousDay = new Date(Date.UTC(year, month - 1, day - 1));
  for (let offset = 0; offset <= 14; offset++) {
    const date = new Date(previousDay);
    date.setUTCDate(date.getUTCDate() - offset);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    const dateText = date.toISOString().slice(0, 10);
    const url = dateText === today ? 'https://www.tcmb.gov.tr/kurlar/today.xml' : `https://www.tcmb.gov.tr/kurlar/${dateText.slice(0, 4)}${dateText.slice(5, 7)}/${dateText.slice(8, 10)}${dateText.slice(5, 7)}${dateText.slice(0, 4)}.xml`;
    try {
      const parsed = parseTcmbRates(await fetchXml(url));
      if (!parsed.effectiveDate || parsed.effectiveDate > previousDay.toISOString().slice(0, 10)) continue;
      const rate = parsed.rates.get(currency);
      if (rate) return rate;
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
    }
  }
  throw new Error('No published TCMB effective buying rate was found for this date.');
}

const authAttempts = new Map();
function limitGoogleSignIn(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowStart = now - 15 * 60 * 1000;
  if (!authAttempts.has(key) && authAttempts.size >= 5000) {
    for (const [address, times] of authAttempts) if (!times.some(timestamp => timestamp > windowStart)) authAttempts.delete(address);
    if (authAttempts.size >= 5000) {
      res.setHeader('Retry-After', '60');
      return fail(res, 429, 'Giriş hizmeti geçici olarak yoğun. Bir dakika sonra tekrar deneyin.');
    }
  }
  const attempts = (authAttempts.get(key) || []).filter(timestamp => timestamp > windowStart);
  if (attempts.length >= 12) {
    res.setHeader('Retry-After', '900');
    return fail(res, 429, 'Çok fazla giriş denemesi yapıldı. 15 dakika sonra tekrar deneyin.');
  }
  attempts.push(now);
  authAttempts.set(key, attempts);
  return next();
}

const exchangeRateAttempts = new Map();
function limitExchangeRateRequests(req, res, next) {
  const key = `${req.user.id}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const now = Date.now();
  const windowStart = now - 60_000;
  if (!exchangeRateAttempts.has(key) && exchangeRateAttempts.size >= 5000) {
    for (const [address, times] of exchangeRateAttempts) if (!times.some(timestamp => timestamp > windowStart)) exchangeRateAttempts.delete(address);
    if (exchangeRateAttempts.size >= 5000) return fail(res, 429, 'Kur sorgusu sınırına ulaşıldı. Bir dakika sonra tekrar deneyin.');
  }
  const attempts = (exchangeRateAttempts.get(key) || []).filter(timestamp => timestamp > windowStart);
  if (attempts.length >= 30) {
    res.setHeader('Retry-After', '60');
    return fail(res, 429, 'Kur sorgusu sınırına ulaşıldı. Bir dakika sonra tekrar deneyin.');
  }
  attempts.push(now);
  exchangeRateAttempts.set(key, attempts);
  return next();
}

app.get('/api/health', route(async (_req, res) => {
  try {
    await db.query('SELECT 1');
    return res.json({ status: 'ok', database: 'mysql' });
  } catch {
    return res.status(503).json({ status: 'unavailable', database: 'unavailable' });
  }
}));
app.get('/api/auth/config', (_req, res) => res.setHeader('Cache-Control', 'no-store').json({ googleClientId: googleClientId || null }));

app.post('/api/auth/google', sameOriginMutation, limitGoogleSignIn, route(async (req, res) => {
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

app.get('/api/exchange-rates/currencies', limitExchangeRateRequests, route(async (_req, res) => {
  let todayXml;
  try { todayXml = await fetchTcmbXml('https://www.tcmb.gov.tr/kurlar/today.xml'); }
  catch { return res.setHeader('Cache-Control', 'private, max-age=300').json({ effectiveDate: null, currencies: tcmbCurrencyFallback }); }
  const { rates, effectiveDate } = parseTcmbRates(todayXml);
  const currencies = new Set(rates.keys());
  for (const code of ['EUR', 'USD', 'GBP']) currencies.add(code);
  return res.setHeader('Cache-Control', 'private, max-age=300').json({ effectiveDate, currencies: [...currencies].sort() });
}));
app.get('/api/exchange-rates', limitExchangeRateRequests, route(async (req, res) => {
  const currency = String(req.query.currency || '').toUpperCase();
  const requestedDate = String(req.query.date || localToday());
  if (!/^[A-Z]{3}$/.test(currency) || currency === 'TRY' || !isValidDate(requestedDate)) return fail(res, 400, 'Para birimi veya tarih geçersiz.');
  const latestDeviceDate = new Date(`${localToday()}T00:00:00Z`);
  latestDeviceDate.setUTCDate(latestDeviceDate.getUTCDate() + 1);
  if (requestedDate > latestDeviceDate.toISOString().slice(0, 10)) return fail(res, 400, 'Bir günden daha ileri tarihli işlemler için henüz kur bulunmuyor.');
  let rate;
  try { rate = await getTcmbRate(currency, requestedDate); }
  catch { return fail(res, 503, 'Bu tarih için TCMB efektif alış kuru alınamadı. Kuru elle girebilirsin.'); }
  return res.setHeader('Cache-Control', 'private, max-age=300').json(rate);
}));

app.get('/api/transactions', route(async (req, res) => {
  const clauses = ['t.user_id=?']; const values = [req.user.id];
  if (req.query.type !== undefined) {
    if (typeof req.query.type !== 'string' || !['Income', 'Expense'].includes(req.query.type)) return fail(res, 400, 'İşlem türü Income veya Expense olmalı.');
    clauses.push('t.type=?'); values.push(req.query.type);
  }
  if (req.query.from !== undefined) {
    if (!isValidDate(req.query.from)) return fail(res, 400, 'Başlangıç tarihi YYYY-MM-DD biçiminde geçerli olmalı.');
    clauses.push('t.transaction_date>=?'); values.push(req.query.from);
  }
  if (req.query.to !== undefined) {
    if (!isValidDate(req.query.to)) return fail(res, 400, 'Bitiş tarihi YYYY-MM-DD biçiminde geçerli olmalı.');
    clauses.push('t.transaction_date<=?'); values.push(req.query.to);
  }
  if (req.query.from && req.query.to && req.query.from > req.query.to) return fail(res, 400, 'Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  return res.json(rowsAsNumbers(await all(`${transactionSelect} WHERE ${clauses.join(' AND ')} ORDER BY t.transaction_date DESC,t.id DESC`, values), ['id', 'amount', 'original_amount', 'exchange_rate', 'tcmb_rate', 'category_id']));
}));

app.post('/api/transactions', route(async (req, res) => {
  const error = await validateTransaction(req.body, req.user.id); if (error) return fail(res, 400, error);
  const result = await withTransaction(async connection => {
    const inserted = await run('INSERT INTO transactions(user_id,type,amount,original_amount,currency_code,exchange_rate,tcmb_rate,rate_source,rate_effective_date,description,category_id,transaction_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [req.user.id, req.body.type, req.body.amount, req.body.original_amount, req.body.currency_code, String(req.body.exchange_rate), req.body.tcmb_rate ? String(req.body.tcmb_rate) : null, req.body.rate_source, req.body.rate_effective_date || null, req.body.description.trim(), req.body.category_id, req.body.transaction_date], connection);
    await run('INSERT INTO exchange_rate_logs(transaction_id,user_id,currency_code,original_amount,try_amount,applied_rate,tcmb_rate,rate_source,rate_effective_date) VALUES (?,?,?,?,?,?,?,?,?)', [inserted.insertId, req.user.id, req.body.currency_code, req.body.original_amount, req.body.amount, String(req.body.exchange_rate), req.body.tcmb_rate ? String(req.body.tcmb_rate) : null, req.body.rate_source, req.body.rate_effective_date || null], connection);
    return inserted;
  });
  return res.status(201).json(asNumbers(await get(`${transactionSelect} WHERE t.id=? AND t.user_id=?`, [Number(result.insertId), req.user.id]), ['id', 'amount', 'original_amount', 'exchange_rate', 'tcmb_rate', 'category_id']));
}));

app.put('/api/transactions/:id', route(async (req, res) => {
  const id = positiveId(req.params.id); if (!id) return fail(res, 400, 'Geçersiz işlem kimliği.');
  const current = await get('SELECT * FROM transactions WHERE id=? AND user_id=?', [id, req.user.id]);
  if (!current) return fail(res, 404, 'İşlem bulunamadı.');
  const error = await validateTransaction(req.body, req.user.id); if (error) return fail(res, 400, error);
  await withTransaction(async connection => {
    await run('UPDATE transactions SET type=?,amount=?,original_amount=?,currency_code=?,exchange_rate=?,tcmb_rate=?,rate_source=?,rate_effective_date=?,description=?,category_id=?,transaction_date=? WHERE id=? AND user_id=?', [req.body.type, req.body.amount, req.body.original_amount, req.body.currency_code, String(req.body.exchange_rate), req.body.tcmb_rate ? String(req.body.tcmb_rate) : null, req.body.rate_source, req.body.rate_effective_date || null, req.body.description.trim(), req.body.category_id, req.body.transaction_date, id, req.user.id], connection);
    const changedRate = current.currency_code !== req.body.currency_code || Number(current.exchange_rate) !== Number(req.body.exchange_rate) || current.rate_source !== req.body.rate_source || Number(current.original_amount) !== req.body.original_amount || String(current.rate_effective_date || '') !== String(req.body.rate_effective_date || '') || Number(current.tcmb_rate || 0) !== Number(req.body.tcmb_rate || 0);
    if (changedRate) await run('INSERT INTO exchange_rate_logs(transaction_id,user_id,currency_code,original_amount,try_amount,applied_rate,tcmb_rate,rate_source,rate_effective_date) VALUES (?,?,?,?,?,?,?,?,?)', [id, req.user.id, req.body.currency_code, req.body.original_amount, req.body.amount, String(req.body.exchange_rate), req.body.tcmb_rate ? String(req.body.tcmb_rate) : null, req.body.rate_source, req.body.rate_effective_date || null], connection);
  });
  return res.json(asNumbers(await get(`${transactionSelect} WHERE t.id=? AND t.user_id=?`, [id, req.user.id]), ['id', 'amount', 'original_amount', 'exchange_rate', 'tcmb_rate', 'category_id']));
}));

app.get('/api/transactions/:id/rate-history', route(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 400, 'Geçersiz işlem kimliği.');
  if (!await get('SELECT id FROM transactions WHERE id=? AND user_id=?', [id, req.user.id])) return fail(res, 404, 'İşlem bulunamadı.');
  return res.json(rowsAsNumbers(await all('SELECT id,currency_code,original_amount,try_amount,applied_rate,tcmb_rate,rate_source,rate_effective_date,created_at FROM exchange_rate_logs WHERE transaction_id=? AND user_id=? ORDER BY created_at,id', [id, req.user.id]), ['id','original_amount','try_amount','applied_rate','tcmb_rate']));
}));

app.delete('/api/transactions/:id', route(async (req, res) => {
  const id = positiveId(req.params.id); if (!id) return fail(res, 400, 'Geçersiz işlem kimliği.');
  const result = await run('DELETE FROM transactions WHERE id=? AND user_id=?', [id, req.user.id]);
  return result.affectedRows ? res.status(204).end() : fail(res, 404, 'İşlem bulunamadı.');
}));

app.get('/api/categories', route(async (req, res) => res.json(rowsAsNumbers(await all('SELECT * FROM categories WHERE user_id=? ORDER BY type,name', [req.user.id]), ['id', 'user_id', 'is_default', 'is_preferred']))));
app.post('/api/categories', route(async (req, res) => {
  const { name, type, color = '#64748b', icon = 'circle' } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 40 || !['Income', 'Expense'].includes(type) || typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color) || typeof icon !== 'string' || !categoryIcons.has(icon)) return fail(res, 400, 'Kategori adı, türü, rengi veya simgesi geçersiz.');
  try {
    const result = await run('INSERT INTO categories(user_id,name,type,color,icon) VALUES (?,?,?,?,?)', [req.user.id, name.trim(), type, color, icon]);
    return res.status(201).json(asNumbers(await get('SELECT * FROM categories WHERE id=? AND user_id=?', [Number(result.insertId), req.user.id]), ['id', 'user_id', 'is_default', 'is_preferred']));
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Bu kategori zaten var.'); throw error; }
}));
app.put('/api/categories/:id/preferred', route(async (req, res) => {
  const id = positiveId(req.params.id);
  if (!id) return fail(res, 400, 'Geçersiz kategori kimliği.');
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
  const id = positiveId(req.params.id); if (!id) return fail(res, 400, 'Geçersiz kategori kimliği.');
  const current = await get('SELECT * FROM categories WHERE id=? AND user_id=?', [id, req.user.id]);
  if (!current) return fail(res, 404, 'Kategori bulunamadı.');
  const { name, color = current.color, icon = current.icon } = req.body || {};
  if (current.is_default || typeof name !== 'string' || !name.trim() || name.trim().length > 40 || typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color) || typeof icon !== 'string' || !categoryIcons.has(icon)) return fail(res, 400, 'Varsayılan kategori düzenlenemez veya bilgiler geçersiz.');
  try {
    await run('UPDATE categories SET name=?,color=?,icon=? WHERE id=? AND user_id=?', [name.trim(), color, icon, id, req.user.id]);
    return res.json(asNumbers(await get('SELECT * FROM categories WHERE id=? AND user_id=?', [id, req.user.id]), ['id', 'user_id', 'is_default', 'is_preferred']));
  } catch (error) { if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Bu kategori zaten var.'); throw error; }
}));
app.delete('/api/categories/:id', route(async (req, res) => {
  const id = positiveId(req.params.id); if (!id) return fail(res, 400, 'Geçersiz kategori kimliği.');
  let outcome = 'deleted';
  try {
    await withTransaction(async connection => {
      await all('SELECT id FROM categories WHERE user_id=? AND type=(SELECT type FROM categories WHERE id=? AND user_id=?) FOR UPDATE', [req.user.id, id, req.user.id], connection);
      const category = await get('SELECT * FROM categories WHERE id=? AND user_id=?', [id, req.user.id], connection);
      if (!category) { outcome = 'missing'; return; }
      if (category.is_default) { outcome = 'default'; return; }
      await run('DELETE FROM categories WHERE id=? AND user_id=?', [id, req.user.id], connection);
      if (category.is_preferred) {
        const fallback = await get('SELECT id FROM categories WHERE user_id=? AND type=? ORDER BY is_default DESC,id ASC LIMIT 1', [req.user.id, category.type], connection);
        if (fallback) await run('UPDATE categories SET is_preferred=1 WHERE id=? AND user_id=?', [fallback.id, req.user.id], connection);
      }
    });
    if (outcome === 'missing') return fail(res, 404, 'Kategori bulunamadı.');
    if (outcome === 'default') return fail(res, 400, 'Varsayılan kategori silinemez.');
    return res.status(204).end();
  } catch (error) { if (error.code === 'ER_ROW_IS_REFERENCED_2') return fail(res, 409, 'Bu kategori işlemlerde kullanılıyor.'); throw error; }
}));

app.get('/api/dashboard/summary', route(async (req, res) => {
  const totals = await get("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=?", [req.user.id]);
  const monthParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const month = `${monthParts.year}-${monthParts.month}`; const previous = new Date(`${month}-01T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() - 1); const priorMonth = previous.toISOString().slice(0, 7);
  const monthly = await get("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND DATE_FORMAT(transaction_date,'%Y-%m')=?", [req.user.id, month]);
  const prior = await get("SELECT COALESCE(SUM(CASE WHEN type='Income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND DATE_FORMAT(transaction_date,'%Y-%m')=?", [req.user.id, priorMonth]);
  const recent = rowsAsNumbers(await all(`${transactionSelect} WHERE t.user_id=? ORDER BY t.transaction_date DESC,t.id DESC LIMIT 6`, [req.user.id]), ['id', 'amount', 'original_amount', 'exchange_rate', 'tcmb_rate', 'category_id']);
  const categories = rowsAsNumbers(await all("SELECT c.name,c.color,COALESCE(SUM(t.amount),0) amount FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.user_id=c.user_id AND t.type='Expense' AND DATE_FORMAT(t.transaction_date,'%Y-%m')=? WHERE c.user_id=? AND c.type='Expense' GROUP BY c.id HAVING amount>0 ORDER BY amount DESC", [month, req.user.id]), ['amount']);
  return res.json({ balance: Number(totals.income) - Number(totals.expense), income: Number(totals.income), expense: Number(totals.expense), monthIncome: Number(monthly.income), monthExpense: Number(monthly.expense), previousMonthIncome: Number(prior.income), previousMonthExpense: Number(prior.expense), recent, categories });
}));

app.get('/api/reports/monthly', route(async (req, res) => {
  const year = req.query.year === undefined ? new Date().getFullYear() : Number(req.query.year);
  if (typeof req.query.year !== 'undefined' && (typeof req.query.year !== 'string' || !/^\d{4}$/.test(req.query.year) || !Number.isInteger(year) || year < 1000 || year > 9999)) {
    return fail(res, 400, 'Rapor yılı 1000 ile 9999 arasında geçerli bir yıl olmalı.');
  }
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

module.exports = { app, db, migrate, start, parseTcmbRates, calculateTryMinor, fetchTcmbXml, getTcmbRate, matchesTcmbQuote };
