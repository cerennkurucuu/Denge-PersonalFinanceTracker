const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyGoogleIdToken } = require('./google-id-token.cjs');
const { isTrustedOrigin, normalizeAppOrigin, parseTrustedProxyHops, validateProductionConfiguration } = require('./security-config.cjs');
const { normalizeMerchant, guessCategory } = require('./merchant-category-rules.cjs');
const { buildFinancialPlan, analyzeSpending } = require('./finance-engine.cjs');
const { createTotpSecret, findTotpCounter, verifyTotp, encryptSecret, decryptSecret, provisioningUri, createRecoveryCodes, hashRecoveryCode } = require('./totp.cjs');

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
  if (production) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' https://accounts.google.com/gsi/client",
      "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://accounts.google.com/gsi/",
      "frame-src https://accounts.google.com/gsi/",
    ].join('; '));
  }
  next();
});
app.use(express.json({ limit: '12mb' }));

const mysqlOptions = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  // Use one pooled connection by default for personal apps on shared/test MySQL accounts.
  // Higher limits can be configured explicitly when the database account allows them.
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 1),
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
const mfaChallengeCookieName = 'denge_mfa_challenge';
// Keep the authenticated browser session across app/server restarts for 30 days.
const sessionLifetimeSeconds = 30 * 24 * 60 * 60;
const hashSession = token => crypto.createHash('sha256').update(token).digest('hex');
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: sessionLifetimeSeconds * 1000 };
const mfaChallengeCookieOptions = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/api/auth/mfa/verify', maxAge: 5 * 60 * 1000 };
const mfaEncryptionKey = (process.env.MFA_ENCRYPTION_KEY || '').trim();
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const transactionSelect = `SELECT t.id,t.type,t.amount,t.original_amount,t.currency_code,t.exchange_rate,t.tcmb_rate,t.rate_source,t.rate_effective_date,t.entry_kind,t.merchant_name,t.description,t.category_id,t.transaction_date,t.created_at,t.updated_at,c.name AS category,c.color AS category_color,c.icon AS category_icon FROM transactions t JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id`;
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

  const droppedIndex = /^ALTER\s+TABLE\s+`?[a-z0-9_]+`?\s+DROP\s+(?:KEY|INDEX)\s+`?([a-z0-9_]+)`?/i.exec(statement)?.[1];
  if (droppedIndex) {
    const exists = await get(
      'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',
      [table, droppedIndex],
    );
    return !exists;
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
    const session = await get('SELECT u.id,u.google_sub,u.email,u.name,s.expires_at,s.last_activity_at,COALESCE(st.session_timeout_minutes,10) session_timeout_minutes FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN settings st ON st.user_id=u.id WHERE s.token_hash=?', [hashSession(token)]);
    const now=Math.floor(Date.now()/1000);
    const idleLimit=Number(session?.session_timeout_minutes||10)*60;
    const storedLastActivityAt=Number(session?.last_activity_at||0);
    const lastActivityAt=storedLastActivityAt>0?storedLastActivityAt:now;
    if (!session || Number(session.expires_at) <= now || (lastActivityAt>0&&now-lastActivityAt >= idleLimit)) {
      if (session) await run('DELETE FROM auth_sessions WHERE token_hash=?', [hashSession(token)]);
      res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
      return fail(res, 401, 'Oturum süresi doldu. Güvenliğiniz için yeniden giriş yapın.');
    }
    if(storedLastActivityAt===0||now-storedLastActivityAt>=60) await run('UPDATE auth_sessions SET last_activity_at=? WHERE token_hash=? AND last_activity_at=?',[now,hashSession(token),storedLastActivityAt]);
    req.user = { id: Number(session.id), googleSub: session.google_sub, email: session.email, name: session.name };
    return next();
  } catch (error) { return next(error); }
}

const requestBuckets=new Map();
function limitRequests({name,max,windowMs,keyFor}) {
  return (req,res,next)=>{
    const now=Date.now(),key=name+':'+keyFor(req);
    let bucket=requestBuckets.get(key);
    if(!bucket||bucket.expiresAt<=now){
      if(bucket)requestBuckets.delete(key);
      if(requestBuckets.size>=10000){for(const [id,item] of requestBuckets)if(item.expiresAt<=now)requestBuckets.delete(id);if(requestBuckets.size>=10000)return fail(res,429,'Sunucu geçici olarak yoğun. Biraz sonra tekrar deneyin.');}
      bucket={count:0,expiresAt:now+windowMs};requestBuckets.set(key,bucket);
    }
    if(bucket.count>=max){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((bucket.expiresAt-now)/1000))));return fail(res,429,'İstek sınırına ulaşıldı. Biraz bekleyip yeniden deneyin.');}
    bucket.count++;
    return next();
  };
}
const limitPublicRequest=limitRequests({name:'public',max:120,windowMs:60_000,keyFor:req=>req.ip||req.socket.remoteAddress||'unknown'});
const limitAuthenticatedRequest=limitRequests({name:'user',max:900,windowMs:5*60_000,keyFor:req=>String(req.user.id)});
const limitStatementPreview=limitRequests({name:'preview',max:12,windowMs:10*60_000,keyFor:req=>String(req.user.id)});
const limitStatementImport=limitRequests({name:'import',max:6,windowMs:10*60_000,keyFor:req=>String(req.user.id)});
const limitMfaVerification=limitRequests({name:'mfa',max:10,windowMs:10*60_000,keyFor:req=>req.ip||req.socket.remoteAddress||'unknown'});
const limitMfaManagement=limitRequests({name:'mfa-management',max:5,windowMs:60*60_000,keyFor:req=>String(req.user.id)});

async function validateTransaction(body, userId, categoryTypes) {
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
  if (!Number.isInteger(body.category_id) || !(categoryTypes ? categoryTypes.get(body.category_id) === body.type : await get('SELECT id FROM categories WHERE id=? AND user_id=? AND type=?', [body.category_id, userId, body.type]))) return 'Geçersiz kategori.';
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

app.get('/api/health', limitPublicRequest, route(async (_req, res) => {
  try {
    await db.query('SELECT 1');
    return res.json({ status: 'ok', database: 'mysql' });
  } catch {
    return res.status(503).json({ status: 'unavailable', database: 'unavailable' });
  }
}));
app.get('/api/auth/config', limitPublicRequest, (_req, res) => res.setHeader('Cache-Control', 'no-store').json({ googleClientId: googleClientId || null }));

app.post('/api/auth/google', sameOriginMutation, limitGoogleSignIn, route(async (req, res) => {
  if (!googleClientId) return fail(res, 503, 'Google girişi henüz yapılandırılmadı. OAuth Web Client ID gerekli.');
  const credential = req.body?.credential;
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 8192) return fail(res, 400, 'Google kimlik bilgisi geçersiz.');
  try {
    const payload = await verifyGoogleIdToken(credential, googleClientId);
    if (!payload?.sub || !payload.email || payload.email_verified !== true) return fail(res, 401, 'Google hesabı doğrulanamadı.');
    const email = payload.email.toLowerCase();
    const name = String(payload.name || payload.given_name || email).slice(0, 120);
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
      return id;
    });
    const user=asNumbers(await get('SELECT id,email,name,totp_enabled FROM users WHERE id=?',[userId]),['id']);
    res.setHeader('Cache-Control', 'no-store');
    if(Number(user.totp_enabled)===1){
      const challenge=crypto.randomBytes(32).toString('base64url');
      await run('DELETE FROM auth_mfa_challenges WHERE expires_at<=?',[Math.floor(Date.now()/1000)]);
      await run('INSERT INTO auth_mfa_challenges(token_hash,user_id,expires_at) VALUES (?,?,?)',[hashSession(challenge),userId,Math.floor(Date.now()/1000)+300]);
      res.cookie(mfaChallengeCookieName,challenge,mfaChallengeCookieOptions);
      return res.json({mfaRequired:true});
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const now=Math.floor(Date.now()/1000);
    await run('INSERT INTO auth_sessions(token_hash,user_id,expires_at,last_activity_at) VALUES (?,?,?,?)',[hashSession(token),userId,now+sessionLifetimeSeconds,now]);
    res.cookie(sessionCookieName, token, cookieOptions);
    return res.json({ user: {id:user.id,email:user.email,name:user.name} });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Bu Google e-posta adresi başka bir hesaba bağlı.');
    const networkFailure = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(error.code);
    if (networkFailure || Number(error.response?.status) >= 500) return fail(res, 503, 'Google doğrulama hizmetine şu anda ulaşılamıyor. Biraz sonra yeniden deneyin.');
    if (error.message?.includes('Google account identity')) return fail(res, 401, 'Google hesabı doğrulanamadı.');
    if (error.message?.includes('Google ID token') || error.message?.includes('Wrong recipient') || error.message?.includes('Invalid issuer') || error.message?.includes('Token used')) return fail(res, 401, 'Google giriş bilgisi geçersiz veya süresi dolmuş.');
    throw error;
  }
}));

app.post('/api/auth/mfa/verify', sameOriginMutation, limitMfaVerification, route(async (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const challenge=cookieValue(req,mfaChallengeCookieName);
  const code=typeof req.body?.code==='string'?req.body.code.trim():'';
  if(!challenge||challenge.length>128||(!/^\d{6}$/.test(code)&&!hashRecoveryCode(code)))return fail(res,400,'6 haneli doğrulama kodunu veya tek kullanımlık yedek kodu gir.');
  if(!/^[a-f\d]{64}$/i.test(mfaEncryptionKey))return fail(res,503,'İki adımlı doğrulama sunucu anahtarı yapılandırılmamış.');
  const sessionToken=crypto.randomBytes(32).toString('base64url');
  const now=Math.floor(Date.now()/1000);
  const result=await withTransaction(async connection=>{
    const current=await get('SELECT c.user_id,c.expires_at,u.email,u.name,u.totp_enabled,u.totp_secret_encrypted,u.totp_last_counter FROM auth_mfa_challenges c JOIN users u ON u.id=c.user_id WHERE c.token_hash=? FOR UPDATE',[hashSession(challenge)],connection);
    if(!current||Number(current.expires_at)<=now||Number(current.totp_enabled)!==1){
      await run('DELETE FROM auth_mfa_challenges WHERE token_hash=?',[hashSession(challenge)],connection);
      return null;
    }
    let valid=false;
    try{
      const counter=findTotpCounter(decryptSecret(current.totp_secret_encrypted,mfaEncryptionKey),code);
      if(counter!==null&&counter>Number(current.totp_last_counter||0)){await run('UPDATE users SET totp_last_counter=? WHERE id=?',[counter,current.user_id],connection);valid=true;}
    }catch{valid=false;}
    if(!valid){
      const recoveryHash=hashRecoveryCode(code);
      if(recoveryHash){
        const recovery=await get('SELECT code_hash FROM auth_mfa_recovery_codes WHERE user_id=? AND code_hash=? FOR UPDATE',[current.user_id,recoveryHash],connection);
        if(recovery){await run('DELETE FROM auth_mfa_recovery_codes WHERE user_id=? AND code_hash=?',[current.user_id,recoveryHash],connection);valid=true;}
      }
    }
    if(!valid)return false;
    await run('DELETE FROM auth_mfa_challenges WHERE token_hash=?',[hashSession(challenge)],connection);
    await run('DELETE FROM auth_sessions WHERE expires_at<=?',[now],connection);
    await run('INSERT INTO auth_sessions(token_hash,user_id,expires_at,last_activity_at) VALUES (?,?,?,?)',[hashSession(sessionToken),current.user_id,now+sessionLifetimeSeconds,now],connection);
    return {id:Number(current.user_id),email:current.email,name:current.name};
  });
  res.clearCookie(mfaChallengeCookieName,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/api/auth/mfa/verify'});
  if(result===false)return fail(res,401,'Doğrulama kodu geçersiz veya süresi dolmuş.');
  if(!result)return fail(res,401,'Giriş doğrulama isteğinin süresi doldu. Google ile yeniden giriş yap.');
  res.cookie(sessionCookieName,sessionToken,cookieOptions);
  return res.json({user:result});
}));

app.post('/api/auth/logout', sameOriginMutation, route(async (req, res) => {
  const token = cookieValue(req, sessionCookieName);
  if (token) await run('DELETE FROM auth_sessions WHERE token_hash=?', [hashSession(token)]);
  res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  const challenge=cookieValue(req,mfaChallengeCookieName);
  if(challenge)await run('DELETE FROM auth_mfa_challenges WHERE token_hash=?',[hashSession(challenge)]);
  res.clearCookie(mfaChallengeCookieName,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',path:'/api/auth/mfa/verify'});
  return res.status(204).end();
}));

app.use('/api', requireAuthentication, sameOriginMutation, limitAuthenticatedRequest);
app.get('/api/auth/me', (req, res) => res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name } }));
app.post('/api/auth/activity',(_req,res)=>res.status(204).end());
app.get('/api/auth/mfa/status',route(async(req,res)=>{
  const user=await get('SELECT totp_enabled FROM users WHERE id=?',[req.user.id]);
  return res.setHeader('Cache-Control','no-store').json({enabled:Number(user?.totp_enabled)===1});
}));
app.post('/api/auth/mfa/setup',limitMfaManagement,route(async(req,res)=>{
  if(!/^[a-f\d]{64}$/i.test(mfaEncryptionKey))return fail(res,503,'İki adımlı doğrulama için sunucu MFA_ENCRYPTION_KEY ayarı eksik.');
  const user=await get('SELECT email,totp_enabled FROM users WHERE id=?',[req.user.id]);
  if(!user)return fail(res,404,'Kullanıcı bulunamadı.');
  if(Number(user.totp_enabled)===1)return fail(res,409,'İki adımlı doğrulama zaten etkin.');
  const secret=createTotpSecret();
  await run('UPDATE users SET totp_pending_secret_encrypted=? WHERE id=?',[encryptSecret(secret,mfaEncryptionKey),req.user.id]);
  return res.setHeader('Cache-Control','no-store').json({secret,otpauthUri:provisioningUri(secret,user.email)});
}));
app.post('/api/auth/mfa/enable',limitMfaManagement,route(async(req,res)=>{
  if(!/^[a-f\d]{64}$/i.test(mfaEncryptionKey))return fail(res,503,'İki adımlı doğrulama için sunucu MFA_ENCRYPTION_KEY ayarı eksik.');
  const user=await get('SELECT totp_pending_secret_encrypted,totp_enabled FROM users WHERE id=?',[req.user.id]);
  if(!user?.totp_pending_secret_encrypted)return fail(res,409,'Önce doğrulama uygulamasını kur.');
  let valid=false;
  try{valid=verifyTotp(decryptSecret(user.totp_pending_secret_encrypted,mfaEncryptionKey),String(req.body?.code||''));}catch{valid=false;}
  if(!valid)return fail(res,400,'Kod doğrulanamadı. Telefonundaki güncel 6 haneli kodu kontrol et.');
  const recoveryCodes=createRecoveryCodes();
  await withTransaction(async connection=>{
    await run('UPDATE users SET totp_secret_encrypted=totp_pending_secret_encrypted,totp_pending_secret_encrypted=NULL,totp_enabled=1 WHERE id=?',[req.user.id],connection);
    await run('DELETE FROM auth_mfa_recovery_codes WHERE user_id=?',[req.user.id],connection);
    for(const recoveryCode of recoveryCodes)await run('INSERT INTO auth_mfa_recovery_codes(user_id,code_hash) VALUES (?,?)',[req.user.id,hashRecoveryCode(recoveryCode)],connection);
  });
  return res.setHeader('Cache-Control','no-store').json({enabled:true,recoveryCodes});
}));
app.post('/api/auth/mfa/disable',limitMfaManagement,route(async(req,res)=>{
  if(!/^[a-f\d]{64}$/i.test(mfaEncryptionKey))return fail(res,503,'İki adımlı doğrulama sunucu anahtarı yapılandırılmamış.');
  const user=await get('SELECT totp_secret_encrypted,totp_enabled,totp_last_counter FROM users WHERE id=?',[req.user.id]);
  if(!user||Number(user.totp_enabled)!==1)return fail(res,409,'İki adımlı doğrulama etkin değil.');
  const code=String(req.body?.code||'');
  let counter=null;
  try{counter=findTotpCounter(decryptSecret(user.totp_secret_encrypted,mfaEncryptionKey),code);}catch{counter=null;}
  const validTotp=counter!==null&&counter>Number(user.totp_last_counter||0);
  let valid=validTotp;
  if(!valid){
    const recoveryHash=hashRecoveryCode(code);
    if(recoveryHash){
      const result=await withTransaction(async connection=>{
        const recovery=await get('SELECT code_hash FROM auth_mfa_recovery_codes WHERE user_id=? AND code_hash=? FOR UPDATE',[req.user.id,recoveryHash],connection);
        if(!recovery)return false;
        await run('DELETE FROM auth_mfa_recovery_codes WHERE user_id=? AND code_hash=?',[req.user.id,recoveryHash],connection);
        await run('UPDATE users SET totp_secret_encrypted=NULL,totp_pending_secret_encrypted=NULL,totp_enabled=0 WHERE id=?',[req.user.id],connection);
        await run('DELETE FROM auth_mfa_recovery_codes WHERE user_id=?',[req.user.id],connection);
        return true;
      });
      if(!result)return fail(res,401,'Doğrulama kodu doğru olmadığı için koruma kapatılamadı.');
      return res.setHeader('Cache-Control','no-store').json({enabled:false});
    }
    return fail(res,401,'Doğrulama kodu doğru olmadığı için koruma kapatılamadı.');
  }
  await withTransaction(async connection=>{
    await run('UPDATE users SET totp_secret_encrypted=NULL,totp_pending_secret_encrypted=NULL,totp_enabled=0,totp_last_counter=? WHERE id=?',[counter,req.user.id],connection);
    await run('DELETE FROM auth_mfa_recovery_codes WHERE user_id=?',[req.user.id],connection);
  });
  return res.setHeader('Cache-Control','no-store').json({enabled:false});
}));

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
app.post('/api/exchange-rates/batch', limitExchangeRateRequests, route(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 300) return fail(res, 400, 'Kur listesi geçersiz veya 300 satır sınırını aşıyor.');
  const unique = new Map();
  for (const item of items) {
    const currency = String(item?.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || currency === 'TRY' || !isValidDate(item?.date)) return fail(res, 400, 'Kur listesinde geçersiz para birimi veya tarih var.');
    unique.set(`${currency}|${item.date}`, { currency, date: item.date });
  }
  const latest = new Date(`${localToday()}T00:00:00Z`);
  latest.setUTCDate(latest.getUTCDate() + 1);
  if ([...unique.values()].some(item => item.date > latest.toISOString().slice(0, 10))) return fail(res, 400, 'Kur tarihleri bugünden ileri olamaz.');
  const quotes = await Promise.all([...unique].map(async ([key, item]) => {
    try { return { key, quote: await getTcmbRate(item.currency, item.date) }; }
    catch { return { key, quote: null, error: 'Bu tarih için TCMB efektif alış kuru alınamadı.' }; }
  }));
  return res.setHeader('Cache-Control', 'private, max-age=300').json({ quotes: Object.fromEntries(quotes.map(item => [item.key, item])) });
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

app.delete('/api/transactions', route(async (req, res) => {
  const requestedIds = req.body?.ids;
  if (!Array.isArray(requestedIds) || requestedIds.length < 1 || requestedIds.length > 500
    || requestedIds.some(id => !Number.isSafeInteger(id) || id < 1)) {
    return fail(res, 400, 'Silinecek işlem kimlikleri geçersiz; bir istekte en fazla 500 işlem seçilebilir.');
  }
  const ids = [...new Set(requestedIds)];
  const placeholders = ids.map(() => '?').join(',');
  const deletedAll = await withTransaction(async connection => {
    const owned = await all(`SELECT id FROM transactions WHERE user_id=? AND id IN (${placeholders}) FOR UPDATE`, [req.user.id, ...ids], connection);
    if (owned.length !== ids.length) return false;
    await run(`DELETE FROM transactions WHERE user_id=? AND id IN (${placeholders})`, [req.user.id, ...ids], connection);
    return true;
  });
  if (!deletedAll) return fail(res, 404, 'Seçilen işlemlerden bazıları bulunamadı; hiçbir işlem silinmedi. Listeyi yenileyip tekrar dene.');
  return res.json({ deleted: ids.length });
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

function statementFingerprint(item) {
  const canonical = [item.transaction_date, item.type, item.currency_code, item.original_amount, normalizeMerchant(item.merchant_name || item.description), normalizeMerchant(item.reference || '')].join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function likelySameMerchant(left, right) {
  const a = normalizeMerchant(left);
  const b = normalizeMerchant(right);
  return Boolean(a && b && (a === b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a)))));
}

function validStatementItem(item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    && ['Income', 'Expense'].includes(item.type)
    && ['standard', 'refund', 'transfer', 'card_payment'].includes(item.entry_kind)
    && isValidDate(item.transaction_date)
    && typeof item.description === 'string' && item.description.trim().length > 0 && item.description.trim().length <= 140
    && /^[A-Z]{3}$/.test(item.currency_code || '')
    && Number.isSafeInteger(item.original_amount) && item.original_amount > 0
    && Number.isSafeInteger(item.amount) && item.amount > 0
    && Number.isFinite(Number(item.exchange_rate)) && Number(item.exchange_rate) > 0
    && Number.isSafeInteger(item.category_id) && item.category_id > 0;
}

app.post('/api/statements/check', limitStatementPreview, route(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 10000 || items.some(item => !item || !isValidDate(item.transaction_date) || typeof item.description !== 'string' || item.description.length > 140 || !Number.isSafeInteger(item.original_amount) || item.original_amount < 1 || !/^[A-Z]{3}$/.test(item.currency_code || '') || !['Income', 'Expense'].includes(item.type))) return fail(res, 400, 'Önizleme satırları geçersiz veya 10000 kayıt sınırını aşıyor.');
  const categories = await all('SELECT id,name,type FROM categories WHERE user_id=? ORDER BY name', [req.user.id]);
  const merchantRules = await all('SELECT normalized_merchant,category_id FROM merchant_category_rules WHERE user_id=?', [req.user.id]);
  const rules = new Map(merchantRules.map(item => [item.normalized_merchant, Number(item.category_id)]));
  const dates=items.map(item => item.transaction_date).sort();
  const existing=await all('SELECT id,import_fingerprint,description,merchant_name,transaction_date,original_amount,currency_code,type FROM transactions WHERE user_id=? AND transaction_date BETWEEN ? AND ?', [req.user.id,dates[0],dates[dates.length-1]]);
  const exactMatches=new Map(existing.map(item => [item.import_fingerprint,item]));
  const key=item => [item.transaction_date,item.original_amount,item.currency_code,item.type].join('|');
  const groups=new Map();
  for (const item of existing) { if (!groups.has(key(item))) groups.set(key(item),[]); groups.get(key(item)).push(item); }
  const result = [];
  for (const item of items) {
    const merchant = normalizeMerchant(item.merchant_name || item.description);
    const knownCategoryId = rules.get(merchant);
    const knownCategory = categories.find(category => Number(category.id) === knownCategoryId && category.type === item.type);
    const suggestion = knownCategory
      ? { category: knownCategory, confidence: 'high', merchant, rule: 'Kayıtlı tercihin' }
      : guessCategory(item.merchant_name || item.description, item.type, categories);
    const fingerprint = statementFingerprint({ ...item, merchant_name: merchant });
    let duplicate = null;
    const exact = exactMatches.get(fingerprint);
    if (exact) duplicate = { kind: 'exact', transactionId: Number(exact.id), description: exact.description };
    else {
      const candidates = (groups.get(key(item)) || []);
      const likely = candidates.find(candidate => likelySameMerchant(merchant, candidate.merchant_name || candidate.description));
      if (likely) duplicate = { kind: 'possible', transactionId: Number(likely.id), description: likely.description };
    }
    result.push({ categoryId: knownCategory?.id ?? suggestion.category?.id ?? null, categoryName: knownCategory?.name ?? suggestion.category?.name ?? null, confidence: suggestion.confidence, matchedRule: suggestion.rule, merchant, fingerprint, duplicate });
  }
  return res.setHeader('Cache-Control', 'no-store').json({ items: result });
}));

app.post('/api/statements/import', limitStatementImport, route(async (req, res) => {
  const body = req.body || {};
  const items = body.items;
  if (!/^[a-f0-9]{64}$/.test(body.fileSha256 || '') || typeof body.fileName !== 'string' || !Array.isArray(items) || items.length > 10000 || !Number.isInteger(body.skippedCount) || body.skippedCount < 0 || body.skippedCount > 10000) return fail(res, 400, 'İçe aktarma bilgileri geçersiz.');
  if (!items.length) return fail(res, 400, 'İçe aktarılacak geçerli bir işlem seçilmedi.');
  const preferences = await get('SELECT allow_duplicate_imports FROM settings WHERE user_id=?', [req.user.id]);
  const allowDuplicates = Number(preferences?.allow_duplicate_imports) === 1;

  let invalid = 0;
  let skippedKinds = 0;
  const categoryTypes = new Map((await all('SELECT id,type FROM categories WHERE user_id=?', [req.user.id])).map(row => [Number(row.id), row.type]));
  const validItems = [];
  for (const item of items) {
    if (item?.entry_kind === 'transfer' || item?.entry_kind === 'card_payment') { skippedKinds += 1; continue; }
    const dateAmount=Number(String(item?.transaction_date || '').split('-').reverse().join(''))*100;
    if ((item?.currency_code==='TRY' && item.original_amount===dateAmount) || !validStatementItem(item) || (item.entry_kind === 'refund' && item.type !== 'Expense')) { invalid += 1; continue; }
    const validation = await validateTransaction({ ...item, description: item.description.trim(), rate_source: item.rate_source, rate_effective_date: item.rate_effective_date, tcmb_rate: item.tcmb_rate ?? null }, req.user.id, categoryTypes);
    if (validation) { invalid += 1; continue; }
    validItems.push({ ...item, description: item.description.trim(), merchant_name: normalizeMerchant(item.merchant_name || item.description), fingerprint: statementFingerprint(item) });
  }
  if (!validItems.length) return res.status(422).json({ error: 'Geçerli kayıt bulunamadı. Ekstre satırlarını ve para birimi kurlarını gözden geçir.', result: { imported: 0, duplicates: 0, skipped: Number(body.skippedCount) + skippedKinds, invalid } });

  let outcome;
  try {
    outcome = await withTransaction(async connection => {
      const extension = path.extname(body.fileName).toLowerCase();
      const fileName = ['.csv','.xls','.xlsx','.pdf'].includes(extension) ? `Ekstre${extension}` : 'Ekstre';
      const batch = await run('INSERT INTO statement_imports(user_id,file_sha256,file_name,source_count,skipped_count) VALUES (?,?,?,?,?)', [req.user.id, body.fileSha256, fileName, items.length + Number(body.skippedCount), Number(body.skippedCount) + skippedKinds], connection);
      const batchId = Number(batch.insertId);
      await get('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user.id], connection);
      const dates = validItems.map(item => item.transaction_date).sort();
      const existing = await all('SELECT import_fingerprint,transaction_date,type,currency_code,original_amount,merchant_name,description FROM transactions WHERE user_id=? AND transaction_date BETWEEN ? AND ?', [req.user.id,dates[0],dates[dates.length-1]], connection);
      const fingerprints = new Set(existing.map(item => item.import_fingerprint).filter(Boolean));
      const key = item => [item.transaction_date,item.type,item.currency_code,item.original_amount].join('|');
      const groups = new Map();
      const add = item => { if (!groups.has(key(item))) groups.set(key(item),[]); groups.get(key(item)).push(item); };
      existing.forEach(add);
      let duplicates=0, potentialDuplicates=0;
      const accepted=[];
      for (const item of validItems) {
        if (!allowDuplicates) {
          if (fingerprints.has(item.fingerprint)) { duplicates++; continue; }
          const possible=(groups.get(key(item)) || []).some(candidate => likelySameMerchant(item.merchant_name,candidate.merchant_name || candidate.description));
          if ((possible || item.duplicateKind==='possible') && item.confirmPotentialDuplicate!==true) { potentialDuplicates++; continue; }
        }
        accepted.push(item); fingerprints.add(item.fingerprint); add(item);
      }
      const fields='user_id,type,amount,original_amount,currency_code,exchange_rate,tcmb_rate,rate_source,rate_effective_date,entry_kind,merchant_name,import_fingerprint,deduplication_key,import_batch_id,description,category_id,transaction_date';
      for (let offset=0;offset<accepted.length;offset+=250) {
        const chunk=accepted.slice(offset,offset+250);
        const values=chunk.flatMap(item => [req.user.id,item.type,item.amount,item.original_amount,item.currency_code,String(item.exchange_rate),item.tcmb_rate ? String(item.tcmb_rate) : null,item.rate_source,item.rate_effective_date || null,item.entry_kind,item.merchant_name,item.fingerprint,allowDuplicates ? null : item.fingerprint,batchId,item.description,item.category_id,item.transaction_date]);
        await run('INSERT INTO transactions('+fields+') VALUES '+chunk.map(() => '('+Array(17).fill('?').join(',')+')').join(','),values,connection);
      }
      await run('INSERT INTO exchange_rate_logs(transaction_id,user_id,currency_code,original_amount,try_amount,applied_rate,tcmb_rate,rate_source,rate_effective_date) SELECT id,user_id,currency_code,original_amount,amount,exchange_rate,tcmb_rate,rate_source,rate_effective_date FROM transactions WHERE user_id=? AND import_batch_id=?',[req.user.id,batchId],connection);
      const rules=new Map(accepted.filter(item => item.learnMerchant && item.merchant_name).map(item => [item.merchant_name,item.category_id]));
      if (rules.size) await run('INSERT INTO merchant_category_rules(user_id,normalized_merchant,category_id) VALUES '+[...rules].map(() => '(?,?,?)').join(',')+' ON DUPLICATE KEY UPDATE category_id=VALUES(category_id)',[...rules].flatMap(([merchant,category]) => [req.user.id,merchant,category]),connection);
      const imported=accepted.length;
      const skipped = Number(body.skippedCount) + skippedKinds + invalid + potentialDuplicates;
      await run('UPDATE statement_imports SET imported_count=?,duplicate_count=?,skipped_count=? WHERE id=? AND user_id=?', [imported, duplicates, skipped, batchId, req.user.id], connection);
      return { imported, duplicates, skipped, potentialDuplicates, invalid, batchId };
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Bu ekstre eş zamanlı bir işlemde zaten içe aktarılmış.', duplicateFile: true });
    throw error;
  }
  return res.status(201).json({ result: outcome });
}));

app.get('/api/merchant-rules', route(async (req, res) => res.json(await all('SELECT r.normalized_merchant,r.category_id,c.name AS category,c.type FROM merchant_category_rules r JOIN categories c ON c.id=r.category_id AND c.user_id=r.user_id WHERE r.user_id=? ORDER BY r.normalized_merchant', [req.user.id]))));
app.delete('/api/merchant-rules/:merchant', route(async (req, res) => {
  const merchant = normalizeMerchant(req.params.merchant);
  if (!merchant) return fail(res, 400, 'İş yeri adı geçersiz.');
  await run('DELETE FROM merchant_category_rules WHERE user_id=? AND normalized_merchant=?', [req.user.id, merchant]);
  return res.status(204).end();
}));

app.get('/api/statements', route(async (req, res) => res.json(rowsAsNumbers(await all('SELECT id,file_name,source_count,imported_count,duplicate_count,skipped_count,created_at FROM statement_imports WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 50', [req.user.id]), ['id','source_count','imported_count','duplicate_count','skipped_count']))));

app.get('/api/dashboard/summary', route(async (req, res) => {
  const totals = await get("SELECT COALESCE(SUM(CASE WHEN type='Income' AND entry_kind='standard' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN entry_kind='refund' THEN -amount WHEN type='Expense' THEN amount ELSE 0 END),0) expense,COALESCE(SUM(import_fingerprint IS NOT NULL AND currency_code='TRY' AND original_amount=CAST(DATE_FORMAT(transaction_date,'%d%m%Y') AS UNSIGNED)*100),0) integrity_issues FROM transactions WHERE user_id=?", [req.user.id]);
  if (Number(totals.integrity_issues)>0) return fail(res,422,'İçe aktarılmış kayıtlarda tarih tutar olarak okunmuş olabilir. Kaynak ekstreyle doğrulama gerekli; özet durduruldu.');
  const monthParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  const month = `${monthParts.year}-${monthParts.month}`; const previous = new Date(`${month}-01T00:00:00Z`); previous.setUTCMonth(previous.getUTCMonth() - 1); const priorMonth = previous.toISOString().slice(0, 7);
  const monthly = await get("SELECT COALESCE(SUM(CASE WHEN type='Income' AND entry_kind='standard' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN entry_kind='refund' THEN -amount WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND DATE_FORMAT(transaction_date,'%Y-%m')=?", [req.user.id, month]);
  const prior = await get("SELECT COALESCE(SUM(CASE WHEN type='Income' AND entry_kind='standard' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN entry_kind='refund' THEN -amount WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? AND DATE_FORMAT(transaction_date,'%Y-%m')=?", [req.user.id, priorMonth]);
  const recent = rowsAsNumbers(await all(`${transactionSelect} WHERE t.user_id=? ORDER BY t.transaction_date DESC,t.id DESC LIMIT 6`, [req.user.id]), ['id', 'amount', 'original_amount', 'exchange_rate', 'tcmb_rate', 'category_id']);
  const categories = rowsAsNumbers(await all("SELECT c.name,c.color,COALESCE(SUM(CASE WHEN t.entry_kind='refund' THEN -t.amount ELSE t.amount END),0) amount FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.user_id=c.user_id AND t.type='Expense' AND DATE_FORMAT(t.transaction_date,'%Y-%m')=? WHERE c.user_id=? AND c.type='Expense' GROUP BY c.id HAVING amount>0 ORDER BY amount DESC", [month, req.user.id]), ['amount']);
  return res.json({ balance: Number(totals.income) - Number(totals.expense), income: Number(totals.income), expense: Number(totals.expense), monthIncome: Number(monthly.income), monthExpense: Number(monthly.expense), previousMonthIncome: Number(prior.income), previousMonthExpense: Number(prior.expense), recent, categories });
}));

app.get('/api/reports/totals', route(async (req,res) => {
  const {type,from,to}=req.query;
  if (!['Income','Expense'].includes(type) || !isValidDate(from) || !isValidDate(to) || from>to) return fail(res,400,'Rapor türü ve tarih aralığı geçersiz.');
  const result=await get("SELECT COALESCE(SUM(CASE WHEN entry_kind='refund' THEN -amount ELSE amount END),0) amount,COALESCE(SUM(import_fingerprint IS NOT NULL AND currency_code='TRY' AND original_amount=CAST(DATE_FORMAT(transaction_date,'%d%m%Y') AS UNSIGNED)*100),0) issues FROM transactions WHERE user_id=? AND type=? AND transaction_date BETWEEN ? AND ?",[req.user.id,type,from,to]);
  return res.json({type,amount:Number(result.amount),issues:Number(result.issues)});
}));

app.get('/api/reports/monthly', route(async (req, res) => {
  const year = req.query.year === undefined ? new Date().getFullYear() : Number(req.query.year);
  if (typeof req.query.year !== 'undefined' && (typeof req.query.year !== 'string' || !/^\d{4}$/.test(req.query.year) || !Number.isInteger(year) || year < 1000 || year > 9999)) {
    return fail(res, 400, 'Rapor yılı 1000 ile 9999 arasında geçerli bir yıl olmalı.');
  }
  const rows = await all("SELECT LPAD(MONTH(transaction_date),2,'0') month,COALESCE(SUM(CASE WHEN type='Income' AND entry_kind='standard' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN entry_kind='refund' THEN -amount WHEN type='Expense' THEN amount ELSE 0 END),0) expense,COALESCE(SUM(import_fingerprint IS NOT NULL AND currency_code='TRY' AND original_amount=CAST(DATE_FORMAT(transaction_date,'%d%m%Y') AS UNSIGNED)*100),0) integrity_issues FROM transactions WHERE user_id=? AND YEAR(transaction_date)=? GROUP BY MONTH(transaction_date) ORDER BY MONTH(transaction_date)", [req.user.id, year]);
  if (rows.some(row => Number(row.integrity_issues)>0)) return fail(res,422,'Aylık grafik durduruldu: içe aktarılmış kayıtlarda tarih tutar olarak okunmuş olabilir. Kaynak ekstreyle doğrulama gerekli.');
  const map = new Map(rows.map(row => [Number(row.month), row]));
  return res.json(Array.from({ length: 12 }, (_, index) => asNumbers(map.get(index + 1) || { month: String(index + 1).padStart(2, '0'), income: 0, expense: 0 }, ['income', 'expense'])));
}));
app.get('/api/reports/yearly', route(async (req, res) => res.json(rowsAsNumbers(await all("SELECT CAST(YEAR(transaction_date) AS CHAR) year,COALESCE(SUM(CASE WHEN type='Income' AND entry_kind='standard' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN entry_kind='refund' THEN -amount WHEN type='Expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE user_id=? GROUP BY YEAR(transaction_date) ORDER BY YEAR(transaction_date) DESC", [req.user.id]), ['income', 'expense']))));

function shiftMonth(date, offset) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + offset);
  return result.toISOString().slice(0, 10);
}

function endOfMonth(date) {
  const result = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  result.setUTCMonth(result.getUTCMonth() + 1);
  result.setUTCDate(0);
  return result.toISOString().slice(0, 10);
}

function netPeriod(transactions) {
  return transactions.reduce((sum, transaction) => {
    const amount = Number(transaction.amount) || 0;
    if (transaction.entry_kind === 'refund') sum.expense -= amount;
    else if (transaction.type === 'Income') sum.income += amount;
    else if (!['transfer', 'card_payment'].includes(transaction.entry_kind)) sum.expense += amount;
    return sum;
  }, { income: 0, expense: 0 });
}

async function getAnalysisTransactions(userId, from) {
  const records=rowsAsNumbers(await all(`SELECT t.import_fingerprint, source.* FROM (${transactionSelect} WHERE t.user_id=? AND t.transaction_date>=? ORDER BY t.transaction_date,t.id LIMIT 100001) source JOIN transactions t ON t.id=source.id AND t.user_id=?`,[userId,from,userId]),['id','amount','original_amount','exchange_rate','tcmb_rate','category_id']);
  if (records.length>100000) throw Object.assign(new Error('Analysis range exceeds limit'),{status:422,publicMessage:'Bu analiz aralığı 100.000 kaydı aşıyor. Tarih aralığını daralt.'});
  if (records.some(item => item.import_fingerprint && item.currency_code==='TRY' && item.original_amount===Number(item.transaction_date.split('-').reverse().join(''))*100)) throw Object.assign(new Error('Invalid imported date amount'),{status:422,publicMessage:'İçe aktarılmış kayıtlarda tarih tutar olarak okunmuş olabilir. Kaynak ekstreyle doğrulama gerekli; finansal analiz durduruldu.'});
  return records;
}

app.get('/api/reports/analysis', route(async (req, res) => {
  const today = localToday();
  const defaultFrom = shiftMonth(today, -6);
  const from = req.query.from === undefined ? defaultFrom : req.query.from;
  const to = req.query.to === undefined ? today : req.query.to;
  if (!isValidDate(from) || !isValidDate(to) || from > to || to > today) return fail(res, 400, 'Analiz tarih aralığı geçersiz. Tarihler bugünden ileri olamaz.');
  const transactions = await getAnalysisTransactions(req.user.id, shiftMonth(today, -13));
  const selected = transactions.filter(item => item.transaction_date >= from && item.transaction_date <= to);
  const summary = netPeriod(selected);
  const categoryTotals = new Map();
  const merchants = new Map();
  for (const item of selected) {
    const kind = item.entry_kind || 'standard';
    if (item.type === 'Expense' && !['transfer','card_payment'].includes(kind)) {
      const name = item.category || 'Diğer';
      categoryTotals.set(name, (categoryTotals.get(name) || 0) + (kind === 'refund' ? -item.amount : item.amount));
      const merchant = item.merchant_name || item.description;
      const merchantKey = normalizeMerchant(merchant);
      if (merchantKey) {
        const value = merchants.get(merchantKey) || { merchant, count: 0, amount: 0 };
        value.count += 1;
        value.amount += kind === 'refund' ? -item.amount : item.amount;
        merchants.set(merchantKey, value);
      }
    }
  }
  const end = new Date(`${today}T00:00:00Z`);
  const habits = analyzeSpending(transactions.map(item => ({ ...item, entry_kind: item.entry_kind || 'standard' })), { today: end });
  const monthStart = shiftMonth(today, 0);
  const currentMonth = netPeriod(transactions.filter(item => item.transaction_date >= monthStart && item.transaction_date <= today));
  const previousMonthKey = shiftMonth(today, -1).slice(0, 7);
  const currentMonthKey = today.slice(0, 7);
  const trend = habits.monthlyHistory.filter(item => item.month >= shiftMonth(today, -6).slice(0, 7));
  const payrollStart = shiftMonth(today, -3);
  const payrollDates = transactions.filter(item => item.transaction_date >= payrollStart && item.type === 'Income' && item.entry_kind !== 'refund' && /maaş|maas|salary|bordro/i.test(`${item.category} ${item.description}`)).map(item => item.transaction_date);
  const payrollSpending = payrollDates.map(date => transactions.filter(item => item.type === 'Expense' && item.entry_kind !== 'refund' && item.transaction_date >= date && item.transaction_date < new Date(new Date(`${date}T00:00:00Z`).valueOf() + 7 * 86_400_000).toISOString().slice(0, 10)).reduce((sum, item) => sum + item.amount, 0));
  const feedbackRows = await all('SELECT recommendation_fingerprint,action FROM recommendation_feedback WHERE user_id=?', [req.user.id]);
  const feedback = new Map(feedbackRows.map(item => [item.recommendation_fingerprint, item.action]));
  const recommendations = habits.recommendations.map(item => {
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify([item.kind, item.category || '', item.merchant || '', today.slice(0, 7)])).digest('hex');
    const impact = item.kind === 'category_increase' ? Math.max(0, item.current30Days - item.prior90DayMonthlyAverage) : null;
    return { ...item, fingerprint, expectedImpact: impact, impactBasis: impact === null ? 'İşlem sayısı ve mevcut harcama gösterilir; tasarruf tutarı veriden güvenilir hesaplanamıyor.' : 'Harcama geçmiş 90 günün aylık ortalamasına dönerse oluşabilecek fark; garanti değildir.', feedback: feedback.get(fingerprint) || null };
  }).filter(item => item.feedback !== 'rejected' && item.feedback !== 'dismissed');
  if (currentMonth.income > 0 && currentMonth.expense > currentMonth.income) {
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(['monthly_deficit', today.slice(0, 7)])).digest('hex');
    const action = feedback.get(fingerprint) || null;
    if (action !== 'rejected' && action !== 'dismissed') recommendations.unshift({ kind: 'monthly_deficit', fingerprint, explanation: `Bu ay şu ana kadarki kayıtlı giderler geliri ${new Intl.NumberFormat('tr-TR').format(currentMonth.expense - currentMonth.income)} TL aşıyor.`, expectedImpact: null, impactBasis: 'Mevcut kayıtlı tutarlara dayanır; gelecek harcama tahmini değildir.', confidence: 'high', feedback: action });
  }
  return res.setHeader('Cache-Control', 'no-store').json({
    from, to, summary: { ...summary, net: summary.income - summary.expense, savingsRate: summary.income > 0 ? (summary.income - summary.expense) / summary.income : null },
    currentMonth: { ...currentMonth, net: currentMonth.income - currentMonth.expense, savingsRate: currentMonth.income > 0 ? (currentMonth.income - currentMonth.expense) / currentMonth.income : null },
    monthlyTrend: trend, previousMonth: previousMonthKey, currentMonthKey,
    categories: [...categoryTotals].filter(([, amount]) => amount > 0).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    topMerchants: [...merchants.values()].filter(item => item.amount > 0).sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, 10),
    fixedAndVariable: { repeatedMerchantExpense: habits.repeatedMerchants.reduce((sum, item) => sum + item.amount, 0), otherExpense: Math.max(0, netPeriod(transactions.filter(item => item.transaction_date >= new Date(end.valueOf() - 30 * 86_400_000).toISOString().slice(0, 10) && item.transaction_date <= today && item.type === 'Expense')).expense - habits.repeatedMerchants.reduce((sum, item) => sum + item.amount, 0)), explanation: 'Tekrarlayan işyeri hareketleri sabit gider göstergesi olarak değerlendirilir; bu sınıflandırma kesin değildir.' },
    payrollAfterSpend: payrollSpending.length ? { observations: payrollSpending.length, medianSevenDayExpense: Math.round([...payrollSpending].sort((a, b) => a - b)[Math.floor(payrollSpending.length / 2)]), confidence: payrollSpending.length >= 3 ? 'medium' : 'low' } : null,
    habits, recommendations,
    financialStatus: { recurringDeficitMonths: habits.monthlyHistory.filter(item => item.income > 0 && item.expense > item.income).length, historyMonths: habits.monthlyHistory.length },
  });
}));

app.post('/api/reports/recommendations/:fingerprint/feedback', route(async (req, res) => {
  const fingerprint = req.params.fingerprint;
  const action = req.body?.action;
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || !['accepted','rejected','dismissed'].includes(action)) return fail(res, 400, 'Öneri geri bildirimi geçersiz.');
  await run('INSERT INTO recommendation_feedback(user_id,recommendation_fingerprint,action) VALUES (?,?,?) ON DUPLICATE KEY UPDATE action=VALUES(action),created_at=CURRENT_TIMESTAMP', [req.user.id, fingerprint, action]);
  return res.json({ fingerprint, action });
}));

app.get('/api/plans/preferences', route(async (req, res) => {
  const today = localToday();
  const firstMonth = shiftMonth(today, -3);
  const data = await all("SELECT c.id,c.name,COALESCE(SUM(CASE WHEN t.entry_kind='refund' THEN -t.amount ELSE t.amount END),0) total FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.user_id=c.user_id AND t.type='Expense' AND t.transaction_date>=? AND t.transaction_date<? WHERE c.user_id=? AND c.type='Expense' GROUP BY c.id ORDER BY total DESC,c.name", [firstMonth, shiftMonth(today, 0), req.user.id]);
  const saved = await all('SELECT category_id,protected_amount,reduction_rate FROM plan_category_preferences WHERE user_id=?', [req.user.id]);
  const savedMap = new Map(saved.map(item => [Number(item.category_id), item]));
  const output = data.map(item => {
    const preference = savedMap.get(Number(item.id));
    const average = Math.max(0, Math.round(Number(item.total) / 3));
    return { categoryId: Number(item.id), name: item.name, monthlyAverage: average, protectedAmount: preference ? Number(preference.protected_amount) : average, reductionRate: preference ? Number(preference.reduction_rate) : 0, configured: Boolean(preference) };
  });
  return res.json({ categories: output, monthsUsed: 3, currency: 'TRY' });
}));

app.put('/api/plans/preferences', route(async (req, res) => {
  const preferences = req.body?.categories;
  if (!Array.isArray(preferences) || preferences.length > 200) return fail(res, 400, 'Kategori tercihleri geçersiz.');
  const ownCategories = new Set((await all("SELECT id FROM categories WHERE user_id=? AND type='Expense'", [req.user.id])).map(item => Number(item.id)));
  for (const item of preferences) {
    if (!Number.isInteger(item.categoryId) || !ownCategories.has(item.categoryId) || !Number.isSafeInteger(item.protectedAmount) || item.protectedAmount < 0 || !Number.isFinite(item.reductionRate) || item.reductionRate < 0 || item.reductionRate > 0.8) return fail(res, 400, 'Korunacak tutar veya azaltma oranı geçersiz.');
  }
  await withTransaction(async connection => {
    for (const item of preferences) await run('INSERT INTO plan_category_preferences(user_id,category_id,protected_amount,reduction_rate) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE protected_amount=VALUES(protected_amount),reduction_rate=VALUES(reduction_rate)', [req.user.id, item.categoryId, item.protectedAmount, item.reductionRate,], connection);
  });
  return res.json({ saved: preferences.length });
}));

async function makePlanInputs(userId) {
  const today = localToday();
  const currentStart = shiftMonth(today, 0);
  const firstMonth = shiftMonth(today, -3);
  const rows = await all('SELECT t.type,t.amount,t.entry_kind,t.category_id,c.name AS category,t.transaction_date FROM transactions t JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id WHERE t.user_id=? AND t.transaction_date>=? AND t.transaction_date<? ORDER BY t.transaction_date', [userId, firstMonth, currentStart]);
  const monthly = new Map();
  const categoryMonthly = new Map();
  for (let offset = 3; offset > 0; offset -= 1) {
    const month = shiftMonth(today, -offset).slice(0, 7);
    monthly.set(month, { income: 0, expense: 0 });
  }
  for (const row of rows) {
    const month = row.transaction_date.slice(0, 7);
    if (!monthly.has(month)) continue;
    const value = monthly.get(month);
    const amount = Number(row.amount);
    if (row.entry_kind === 'refund') value.expense -= amount;
    else if (row.type === 'Income') value.income += amount;
    else value.expense += amount;
    if (row.type === 'Expense') {
      const key = `${row.category_id}:${month}`;
      categoryMonthly.set(key, (categoryMonthly.get(key) || 0) + (row.entry_kind === 'refund' ? -amount : amount));
    }
  }
  const nonEmpty = [...monthly.values()].filter(item => item.income > 0 || item.expense > 0);
  if (nonEmpty.length < 2) return { today, currentStart, months: [...monthly], availableMonths: nonEmpty.length, monthlyIncome: 0, monthlyExpense: 0, categories: [] };
  const medianInteger = values => Math.round(values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
  const monthlyIncome = medianInteger([...monthly.values()].map(item => item.income));
  const monthlyExpense = medianInteger([...monthly.values()].map(item => item.expense));
  const categories = await all("SELECT id,name FROM categories WHERE user_id=? AND type='Expense' ORDER BY name", [userId]);
  const preferences = await all('SELECT category_id,protected_amount,reduction_rate FROM plan_category_preferences WHERE user_id=?', [userId]);
  const pref = new Map(preferences.map(item => [Number(item.category_id), item]));
  const planCategories = categories.map(category => {
    const totals = [...monthly.keys()].map(month => categoryMonthly.get(`${Number(category.id)}:${month}`) || 0);
    const average = medianInteger(totals);
    const item = pref.get(Number(category.id));
    return { name: category.name, categoryId: Number(category.id), monthlyAverage: Math.max(0, average), protectedAmount: item ? Number(item.protected_amount) : Math.max(0, average), reductionRate: item ? Number(item.reduction_rate) : 0 };
  });
  return { today, currentStart, months: [...monthly], availableMonths: nonEmpty.length, monthlyIncome, monthlyExpense, categories: planCategories };
}

app.get('/api/plans/scenarios', route(async (req, res) => {
  const targetSavings = Number(req.query.targetSavings);
  if (!Number.isSafeInteger(targetSavings) || targetSavings < 0) return fail(res, 400, 'Aylık birikim hedefi kuruş cinsinden geçerli bir sayı olmalı.');
  const inputs = await makePlanInputs(req.user.id);
  if (inputs.availableMonths < 3) return res.status(422).json({ error: 'Kişisel plan için en az üç tamamlanmış ayın işlem geçmişi gerekli.', availableMonths: inputs.availableMonths });
  const calculation = buildFinancialPlan({ monthlyIncome: inputs.monthlyIncome, monthlyExpense: inputs.monthlyExpense, targetSavings, categories: inputs.categories });
  const scenarios = calculation.scenarios.map(scenario => ({ ...scenario, categoryTargets: scenario.categoryTargets.map(target => ({ ...target, categoryId: calculation.categories.find(category => category.name === target.category)?.categoryId })) }));
  return res.json({ inputs: { monthlyIncome: inputs.monthlyIncome, monthlyExpense: inputs.monthlyExpense, targetSavings, currentNet: calculation.currentNet, currentDeficit: calculation.currentDeficit, requiredImprovement: calculation.requiredImprovement, totalReductionCapacity: calculation.totalReductionCapacity, feasible: calculation.feasible, confidence: 'medium', monthsUsed: inputs.availableMonths }, scenarios });
}));

app.post('/api/plans', route(async (req, res) => {
  const targetSavings = req.body?.targetSavings;
  const scenarioId = req.body?.scenarioId;
  const planName = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
  if (!Number.isSafeInteger(targetSavings) || targetSavings < 0 || !['relaxed','balanced','aggressive'].includes(scenarioId)) return fail(res, 400, 'Plan hedefi veya senaryo geçersiz.');
  const inputs = await makePlanInputs(req.user.id);
  if (inputs.availableMonths < 3) return fail(res, 422, 'Kişisel plan için en az üç tamamlanmış ayın işlem geçmişi gerekli.');
  const calculation = buildFinancialPlan({ monthlyIncome: inputs.monthlyIncome, monthlyExpense: inputs.monthlyExpense, targetSavings, categories: inputs.categories });
  const selected = calculation.scenarios.find(item => item.id === scenarioId);
  const categoryTargets = selected.categoryTargets.map(target => ({ ...target, categoryId: calculation.categories.find(category => category.name === target.category)?.categoryId }));
  const snapshot = { monthlyIncome: inputs.monthlyIncome, monthlyExpense: inputs.monthlyExpense, requiredImprovement: calculation.requiredImprovement, totalReductionCapacity: calculation.totalReductionCapacity, availableMonths: inputs.availableMonths, confidence: inputs.availableMonths >= 3 ? 'medium' : 'low', feasible: calculation.feasible };
  const id = await withTransaction(async connection => {
    await run("UPDATE financial_plans SET status='archived' WHERE user_id=? AND status='active'", [req.user.id], connection);
    const inserted = await run('INSERT INTO financial_plans(user_id,name,start_date,end_date,target_savings,requested_improvement,planned_improvement,category_targets,input_snapshot,status) VALUES (?,?,?,?,?,?,?,?,?,\'active\')', [req.user.id, planName || `${selected.label} plan`, inputs.today, endOfMonth(inputs.today), targetSavings, selected.requestedImprovement, selected.attainableImprovement, JSON.stringify(categoryTargets), JSON.stringify(snapshot)], connection);
    return Number(inserted.insertId);
  });
  return res.status(201).json({ id, scenario: selected, calculation: snapshot });
}));

app.get('/api/plans/current', route(async (req, res) => {
  const plan = await get("SELECT id,name,start_date,end_date,target_savings,requested_improvement,planned_improvement,category_targets,input_snapshot,status,created_at FROM financial_plans WHERE user_id=? AND status='active' ORDER BY created_at DESC,id DESC LIMIT 1", [req.user.id]);
  if (!plan) return res.json({ plan: null });
  const categories = JSON.parse(plan.category_targets || '[]');
  const today = localToday();
  const monthStart = shiftMonth(today, 0);
  const current = await all("SELECT category_id,COALESCE(SUM(CASE WHEN entry_kind='refund' THEN -amount ELSE amount END),0) spent FROM transactions WHERE user_id=? AND type='Expense' AND transaction_date>=? AND transaction_date<=? GROUP BY category_id", [req.user.id, monthStart, today]);
  const byCategory = new Map(current.map(item => [Number(item.category_id), Number(item.spent)]));
  const resultCategories = [];
  for (const category of categories) {
    const currentTotal = byCategory.get(Number(category.categoryId)) || 0;
    const beforeStart = await get("SELECT COALESCE(SUM(CASE WHEN entry_kind='refund' THEN -amount ELSE amount END),0) spent FROM transactions WHERE user_id=? AND type='Expense' AND category_id=? AND transaction_date>=? AND transaction_date<?", [req.user.id, category.categoryId, monthStart, plan.start_date]);
    const amountAlreadySpent = Math.max(0, Number(beforeStart?.spent) || 0);
    const targetAvailableAtStart = Math.max(0, Number(category.monthlyLimit) - amountAlreadySpent);
    const spentAfterStart = Math.max(0, currentTotal - amountAlreadySpent);
    const remaining = targetAvailableAtStart - spentAfterStart;
    resultCategories.push({ ...category, spent: currentTotal, remaining, weeklyBudget: Math.floor(remaining / Math.max(1, Number(endOfMonth(today).slice(-2)) - Number(today.slice(-2)) + 1) * 7), exceeded: remaining < 0, progressPercent: targetAvailableAtStart > 0 ? Math.min(100, Math.round(spentAfterStart / targetAvailableAtStart * 100)) : (spentAfterStart > 0 ? 100 : 0) });
    await run('INSERT IGNORE INTO plan_progress(plan_id,user_id,recorded_on,category_id,spent_amount,target_amount) VALUES (?,?,?,?,?,?)', [plan.id, req.user.id, today, category.categoryId, Math.min(Number.MAX_SAFE_INTEGER, currentTotal), Math.min(Number.MAX_SAFE_INTEGER, Number(category.monthlyLimit))]);
  }
  return res.json({ plan: { ...asNumbers(plan, ['id','target_savings','requested_improvement','planned_improvement']), category_targets: resultCategories, input_snapshot: JSON.parse(plan.input_snapshot || '{}') } });
}));

app.get('/api/plans/history', route(async (req, res) => {
  const plans = await all('SELECT id,name,start_date,end_date,target_savings,requested_improvement,planned_improvement,status,created_at FROM financial_plans WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 24', [req.user.id]);
  return res.json(rowsAsNumbers(plans, ['id','target_savings','requested_improvement','planned_improvement']));
}));

app.patch('/api/plans/:id/status', route(async (req, res) => {
  const id = positiveId(req.params.id);
  const status = req.body?.status;
  if (!id || !['completed','archived'].includes(status)) return fail(res, 400, 'Plan durumu geçersiz.');
  const result = await run('UPDATE financial_plans SET status=? WHERE id=? AND user_id=?', [status, id, req.user.id]);
  if (!result.affectedRows) return fail(res, 404, 'Plan bulunamadı.');
  return res.json({ id, status });
}));
async function settingsForUser(userId) {
  const settings = await get('SELECT currency,theme,language,allow_duplicate_imports,session_timeout_minutes FROM settings WHERE user_id=?', [userId]);
  return settings ? { currency: settings.currency, theme: settings.theme, language: settings.language, allowDuplicateImports: Number(settings.allow_duplicate_imports) === 1, sessionTimeoutMinutes:Number(settings.session_timeout_minutes) } : null;
}

app.get('/api/settings', route(async (req, res) => res.json(await settingsForUser(req.user.id))));
app.put('/api/settings', route(async (req, res) => {
  const body = req.body || {};
  const current = await get('SELECT currency,theme,language,allow_duplicate_imports,session_timeout_minutes FROM settings WHERE user_id=?', [req.user.id]);
  if (!current) return fail(res, 404, 'Kullanıcı ayarları bulunamadı.');
  const currency = body.currency ?? current.currency;
  const theme = body.theme ?? current.theme;
  const language = body.language ?? current.language;
  const allowDuplicateImports = body.allowDuplicateImports ?? (Number(current.allow_duplicate_imports) === 1);
  const sessionTimeoutMinutes = body.sessionTimeoutMinutes ?? Number(current.session_timeout_minutes);
  if (currency !== 'TRY' || !['light', 'dark'].includes(theme) || language !== 'tr' || typeof allowDuplicateImports !== 'boolean' || !Number.isInteger(sessionTimeoutMinutes) || sessionTimeoutMinutes<1 || sessionTimeoutMinutes>480) return fail(res, 400, 'Ayarlar geçersiz.');
  await run('UPDATE settings SET currency=?,theme=?,language=?,allow_duplicate_imports=?,session_timeout_minutes=? WHERE user_id=?', [currency, theme, language, allowDuplicateImports ? 1 : 0,sessionTimeoutMinutes, req.user.id]);
  return res.json(await settingsForUser(req.user.id));
}));
require('./calendar-routes.cjs').registerCalendarRoutes({ app, db, route, fail, withTransaction, localToday, isValidDate, positiveId });
app.use('/api', (_req, res) => fail(res, 404, 'API endpoint bulunamadı.'));
app.use((error, _req, res, _next) => {
  if (!error.status || error.status >= 500) console.error('Request failed:', error.code || 'UNKNOWN');
  if (error.code === 'ER_TOO_MANY_USER_CONNECTIONS' || error.code === 'ER_CON_COUNT_ERROR') {
    return fail(res, 503, 'MySQL eşzamanlı bağlantı sınırına ulaşıldı. API bağlantı havuzu azaltıldı; sunucuyu yeniden başlatıp tekrar deneyin.');
  }
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) {
    return fail(res, 503, 'MySQL bağlantısı şu anda kullanılamıyor. Veritabanı sunucusunu kontrol edip tekrar deneyin.');
  }
  return res.status(error.status || 500).json({ error: error.publicMessage || (error.status === 400 ? 'İstek gövdesi geçersiz JSON içeriyor.' : 'Beklenmeyen sunucu hatası.') });
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
