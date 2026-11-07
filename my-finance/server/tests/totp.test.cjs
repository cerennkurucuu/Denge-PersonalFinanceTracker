const { test } = require('node:test');
const assert = require('node:assert/strict');
const { base32Encode, base32Decode, codeAt, findTotpCounter, verifyTotp, createTotpSecret, encryptSecret, decryptSecret, provisioningUri, createRecoveryCodes, normalizeRecoveryCode, hashRecoveryCode } = require('../totp.cjs');

test('Base32 round-trips an authenticator secret', () => {
  const bytes = Buffer.from('Denge financial security');
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
});

test('generates RFC 6238 six-digit TOTP and accepts only the current time window', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const now = 59_000;
  const code = codeAt(secret, Math.floor(now / 30_000));
  assert.equal(code, '287082');
  assert.equal(verifyTotp(secret, code, { now, window: 0 }), true);
  assert.equal(findTotpCounter(secret,code,{now,window:0}),1);
  assert.equal(verifyTotp(secret, '000000', { now, window: 0 }), false);
  assert.equal(verifyTotp(secret, 'not-a-code', { now }), false);
});

test('encrypts secrets at rest and rejects modified ciphertext', () => {
  const key = 'a'.repeat(64);
  const encrypted = encryptSecret('MY TEST SECRET', key);
  assert.notEqual(encrypted, 'MY TEST SECRET');
  assert.equal(decryptSecret(encrypted, key), 'MY TEST SECRET');
  assert.throws(() => decryptSecret(`${encrypted.slice(0, -1)}x`, key));
  assert.throws(() => encryptSecret('secret', 'bad-key'), /32-byte hexadecimal/);
});

test('creates a random secret and Google Authenticator-compatible provisioning URI', () => {
  const secret = createTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const uri = new URL(provisioningUri(secret, 'user@example.com'));
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.searchParams.get('secret'), secret);
  assert.equal(uri.searchParams.get('issuer'), 'Denge');
  assert.equal(uri.searchParams.get('digits'), '6');
  assert.equal(uri.searchParams.get('period'), '30');
});

test('creates one-time high-entropy recovery codes and stores only normalized hashes',()=>{
  const codes=createRecoveryCodes();
  assert.equal(codes.length,10);
  assert.ok(codes.every(code=>/^[A-F0-9]{4}(?:-[A-F0-9]{4}){4}$/.test(code)));
  assert.equal(normalizeRecoveryCode(codes[0]),codes[0].replaceAll('-',''));
  assert.equal(hashRecoveryCode(codes[0]),hashRecoveryCode(codes[0].replaceAll('-','').toLowerCase()));
  assert.notEqual(hashRecoveryCode(codes[0]),null);
  assert.equal(hashRecoveryCode('invalid'),null);
});
