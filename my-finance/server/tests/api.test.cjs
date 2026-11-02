const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyGoogleIdToken } = require('../google-id-token.cjs');

test('verifies Google ID tokens against the configured audience and rejects invalid identities', async () => {
  let verifyOptions;
  const payload = { sub: 'stable-google-sub', email: 'user@example.com', email_verified: true };
  const client = {
    verifyIdToken: async options => {
      verifyOptions = options;
      return { getPayload: () => payload };
    },
  };

  assert.equal((await verifyGoogleIdToken('g'.repeat(120), 'web-client-id', client)).sub, payload.sub);
  assert.deepEqual(verifyOptions, { idToken: 'g'.repeat(120), audience: 'web-client-id' });
  await assert.rejects(verifyGoogleIdToken('short', 'web-client-id', client), /Google ID token/);
  await assert.rejects(verifyGoogleIdToken('g'.repeat(120), '', client), /audience/);
  await assert.rejects(verifyGoogleIdToken('g'.repeat(120), 'web-client-id', {
    verifyIdToken: async () => ({ getPayload: () => ({ sub: 'missing-email' }) }),
  }), /Google account identity/);
});
