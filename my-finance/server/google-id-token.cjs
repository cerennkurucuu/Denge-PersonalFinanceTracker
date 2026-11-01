const crypto = require('node:crypto');

const googleJwksUrl = 'https://www.googleapis.com/oauth2/v3/certs';
let cachedKeys = null;

function decodePart(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid Google ID token.');
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

async function getGoogleKeys(forceRefresh = false) {
  if (!forceRefresh && cachedKeys && cachedKeys.expiresAt > Date.now()) return cachedKeys.keys;
  const response = await fetch(googleJwksUrl, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Google signing keys are temporarily unavailable.');
  const body = await response.json();
  if (!Array.isArray(body.keys) || body.keys.length === 0) throw new Error('Google signing keys are invalid.');
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300);
  cachedKeys = { keys: body.keys, expiresAt: Date.now() + Math.max(60, Math.min(maxAge, 3600)) * 1000 };
  return cachedKeys.keys;
}

async function verifyGoogleIdToken(token, audience, options = {}) {
  if (typeof token !== 'string' || token.length > 8192 || typeof audience !== 'string' || !audience) throw new Error('Invalid Google ID token.');
  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('Invalid Google ID token.');
  const header = decodePart(segments[0]);
  const payload = decodePart(segments[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) throw new Error('Unsupported Google ID token signature.');

  const fetchKeys = options.fetchKeys || getGoogleKeys;
  let keys = await fetchKeys(false);
  let key = keys.find(candidate => candidate.kid === header.kid && candidate.kty === 'RSA' && candidate.use === 'sig' && (!candidate.alg || candidate.alg === 'RS256'));
  if (!key) {
    keys = await fetchKeys(true);
    key = keys.find(candidate => candidate.kid === header.kid && candidate.kty === 'RSA' && candidate.use === 'sig' && (!candidate.alg || candidate.alg === 'RS256'));
  }
  if (!key) throw new Error('Google ID token signing key is unknown.');
  const signedContent = Buffer.from(`${segments[0]}.${segments[1]}`);
  const signature = Buffer.from(segments[2], 'base64url');
  if (!crypto.verify('RSA-SHA256', signedContent, crypto.createPublicKey({ key, format: 'jwk' }), signature)) throw new Error('Google ID token signature is invalid.');

  const now = Math.floor((options.now ? options.now() : Date.now()) / 1000);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) throw new Error('Google ID token issuer is invalid.');
  if (payload.aud !== audience) throw new Error('Google ID token audience is invalid.');
  if (payload.azp !== undefined && payload.azp !== audience) throw new Error('Google ID token authorized party is invalid.');
  if (!Number.isFinite(payload.exp) || payload.exp <= now || !Number.isFinite(payload.iat) || payload.iat > now + 60) throw new Error('Google ID token has expired or has an invalid issue time.');
  if (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > now + 60)) throw new Error('Google ID token is not active yet.');
  if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string' || !payload.email.includes('@') || payload.email_verified !== true && payload.email_verified !== 'true') throw new Error('Google account identity is not verified.');
  return payload;
}

module.exports = { verifyGoogleIdToken };
