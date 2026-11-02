const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedOrigin, normalizeAppOrigin, parseTrustedProxyHops, validateProductionConfiguration } = require('../security-config.cjs');

test('validates the configured production origin and rejects non-HTTPS URLs or paths', () => {
  assert.equal(normalizeAppOrigin('https://finance.example.com/', { production: true }), 'https://finance.example.com');
  assert.throws(() => normalizeAppOrigin('http://finance.example.com', { production: true }), /HTTPS/);
  assert.throws(() => normalizeAppOrigin('https://finance.example.com/app', { production: true }), /only a scheme/);
  assert.throws(() => normalizeAppOrigin('https://user:secret@finance.example.com', { production: true }), /only a scheme/);
});

test('requires same-origin browser requests in production and supports local development ports', () => {
  assert.equal(isTrustedOrigin({ origin: 'https://finance.example.com', host: 'api.internal' }, { appOrigin: 'https://finance.example.com', production: true }), true);
  assert.equal(isTrustedOrigin({ origin: 'https://attacker.example', host: 'finance.example.com' }, { appOrigin: 'https://finance.example.com', production: true }), false);
  assert.equal(isTrustedOrigin({ host: 'finance.example.com' }, { appOrigin: 'https://finance.example.com', production: true }), false);
  assert.equal(isTrustedOrigin({ origin: 'http://localhost:4201', host: 'localhost:3000' }), true);
  assert.equal(isTrustedOrigin({ origin: 'https://attacker.example', host: 'finance.example.com' }, { production: true }), false);
});

test('accepts only explicit reverse-proxy hop counts', () => {
  assert.equal(parseTrustedProxyHops(undefined), 0);
  assert.equal(parseTrustedProxyHops('2'), 2);
  assert.throws(() => parseTrustedProxyHops('true'), /integer/);
  assert.throws(() => parseTrustedProxyHops('11'), /integer/);
});

test('fails production startup closed when authentication origin, Google client or database TLS is missing', () => {
  assert.doesNotThrow(() => validateProductionConfiguration({ production: false }));
  assert.throws(() => validateProductionConfiguration({ production: true }), /APP_ORIGIN/);
  assert.throws(() => validateProductionConfiguration({ production: true, appOrigin: 'https://finance.example.com' }), /GOOGLE_CLIENT_ID/);
  assert.throws(() => validateProductionConfiguration({ production: true, appOrigin: 'https://finance.example.com', googleClientId: 'client-id' }), /TLS/);
  assert.doesNotThrow(() => validateProductionConfiguration({ production: true, appOrigin: 'https://finance.example.com', googleClientId: 'client-id', mysqlTls: true }));
});
