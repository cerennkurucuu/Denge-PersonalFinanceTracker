const { OAuth2Client } = require('google-auth-library');

const googleAuthClient = new OAuth2Client();

async function verifyGoogleIdToken(token, audience, client = googleAuthClient) {
  if (typeof token !== 'string' || token.length < 100 || token.length > 8192) {
    throw new Error('Google ID token is invalid.');
  }
  if (typeof audience !== 'string' || !audience.trim()) {
    throw new Error('Google ID token audience is not configured.');
  }

  // Google Auth Library validates the signature, issuer, audience, and expiry.
  const ticket = await client.verifyIdToken({ idToken: token, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error('Google account identity is not verified.');
  }
  return payload;
}

module.exports = { verifyGoogleIdToken };
