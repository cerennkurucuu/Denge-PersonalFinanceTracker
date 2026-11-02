function normalizeAppOrigin(value, { production = false } = {}) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;

  let parsed;
  try { parsed = new URL(candidate); }
  catch { throw new Error('APP_ORIGIN must be a valid application origin.'); }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('APP_ORIGIN must contain only a scheme, host, and optional port.');
  }
  if (production && parsed.protocol !== 'https:') throw new Error('APP_ORIGIN must use HTTPS in production.');
  return parsed.origin;
}

function isTrustedOrigin({ origin, host }, { appOrigin = null, production = false } = {}) {
  if (!origin) return !production;

  let parsed;
  try { parsed = new URL(origin); }
  catch { return false; }
  if (parsed.origin !== origin) return false;
  if (appOrigin) return origin === appOrigin;
  if (production) return false;

  const requestHost = String(host || '').split(',')[0].trim();
  if (requestHost && parsed.host.toLowerCase() === requestHost.toLowerCase()) return true;
  return ['localhost', '127.0.0.1'].includes(parsed.hostname) && /^42\d\d$/.test(parsed.port);
}

function parseTrustedProxyHops(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) return 0;
  if (!/^\d+$/.test(candidate)) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  const hops = Number(candidate);
  if (!Number.isSafeInteger(hops) || hops > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  return hops;
}

function validateProductionConfiguration({ production = false, appOrigin = null, googleClientId = '', mysqlTls = false } = {}) {
  if (!production) return;
  if (!appOrigin) throw new Error('APP_ORIGIN must be configured as the public HTTPS origin in production.');
  if (!googleClientId) throw new Error('GOOGLE_CLIENT_ID must be configured in production.');
  if (!mysqlTls) throw new Error('MySQL TLS must be enabled in production.');
}

module.exports = { normalizeAppOrigin, isTrustedOrigin, parseTrustedProxyHops, validateProductionConfiguration };
