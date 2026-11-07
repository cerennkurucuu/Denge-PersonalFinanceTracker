const crypto = require('node:crypto');

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  const normalized = String(value).replace(/=+$/g, '').replace(/\s/g, '').toUpperCase();
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error('Invalid Base32 secret.');
  let bits = 0, accumulator = 0;
  const bytes = [];
  for (const character of normalized) {
    accumulator = (accumulator << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function createTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeAt(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, '0');
}

function findTotpCounter(secret, supplied, { now = Date.now(), window = 1 } = {}) {
  if (typeof supplied !== 'string' || !/^\d{6}$/.test(supplied)) return null;
  const current = Math.floor(now / 30_000);
  const candidate = Buffer.from(supplied);
  const offsets=[0];
  for(let distance=1;distance<=window;distance++)offsets.push(-distance,distance);
  for (const offset of offsets) {
    const expected = Buffer.from(codeAt(secret, current + offset));
    if (crypto.timingSafeEqual(candidate, expected)) return current + offset;
  }
  return null;
}

function verifyTotp(secret, supplied, options) {
  return findTotpCounter(secret,supplied,options)!==null;
}

function encryptSecret(secret, keyHex) {
  if (typeof keyHex !== 'string' || !/^[a-f\d]{64}$/i.test(keyHex)) throw new Error('MFA_ENCRYPTION_KEY must be a 32-byte hexadecimal key.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

function decryptSecret(envelope, keyHex) {
  if (typeof keyHex !== 'string' || !/^[a-f\d]{64}$/i.test(keyHex)) throw new Error('MFA_ENCRYPTION_KEY must be a 32-byte hexadecimal key.');
  const parts = String(envelope).split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted MFA secret.');
  const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function provisioningUri(secret, email, issuer = 'Denge') {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const query = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${query}`;
}

function createRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => crypto.randomBytes(10).toString('hex').toUpperCase().match(/.{1,4}/g).join('-'));
}

function normalizeRecoveryCode(value) {
  const normalized=String(value||'').replace(/[\s-]/g,'').toUpperCase();
  return /^[A-F0-9]{20}$/.test(normalized)?normalized:null;
}

function hashRecoveryCode(value) {
  const normalized=normalizeRecoveryCode(value);
  return normalized?crypto.createHash('sha256').update(normalized).digest('hex'):null;
}

module.exports = { base32Encode, base32Decode, createTotpSecret, codeAt, findTotpCounter, verifyTotp, encryptSecret, decryptSecret, provisioningUri, createRecoveryCodes, normalizeRecoveryCode, hashRecoveryCode };
