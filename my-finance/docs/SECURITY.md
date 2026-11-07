# Denge security and deployment

## Account protection

- Google Sign-In verifies the ID token on the server. The app cannot inspect or enforce whether a consumer Google account has Google 2-Step Verification enabled.
- The optional Denge second factor is TOTP and works with Google Authenticator and compatible authenticator apps. It protects Denge sign-ins after Google identity verification.
- TOTP secrets are encrypted with AES-256-GCM before storage. Generate a local key with `npm run security:setup`. Production deployments must set a unique 64-character hexadecimal `MFA_ENCRYPTION_KEY` in their secret manager. Back it up securely: losing the key makes enrolled authenticator secrets unreadable.
- The key and `.env` must never be committed, pasted into support messages, or placed in a public build. `.env*` is ignored by Git.
- Login sessions use HttpOnly cookies. The default idle timeout is 10 minutes; a user may choose a longer interval in Settings. The browser timer signs out on inactivity, and the server independently invalidates an idle session on its next request.
- Database migrations 007 and 008 add the timeout, activity timestamp, encrypted TOTP fields, and short-lived MFA login challenges without deleting finance records.

## Cloudflare Free deployment

Cloudflare cannot be activated in this repository alone. A domain added to a Cloudflare account and a running production host are required. Use a **named Cloudflare Tunnel**, not a Quick Tunnel, for this private finance app. Quick Tunnels are temporary development links and should not expose personal finance data.

1. Add a domain you control to Cloudflare and complete the registrar nameserver change.
2. Deploy the production app on the host, with MySQL TLS enabled and `APP_ORIGIN=https://finance.your-domain` set. Keep `GOOGLE_CLIENT_ID` and the MFA key in the host's secret configuration.
3. In Cloudflare Zero Trust, create a named Tunnel and a public hostname. Point the hostname to `http://127.0.0.1:3000`; do not expose the Angular development server on 4200/4201.
4. Use `cloudflare/config.example.yml` only as a template. Keep the generated tunnel credentials JSON outside Git and restrict its file permissions. Close public inbound access to port 3000 so the app can only be reached through the tunnel.
5. In Cloudflare Security, enable available managed WAF protections and create a rate-limit rule for sensitive auth/API routes within the Free plan's current allowance. Keep the app's own per-account and per-IP limits as a second layer.
6. Confirm HTTPS, Google OAuth authorized origins, `APP_ORIGIN`, and the custom domain all match. Test Google login, MFA challenge, idle logout, and finance API access before using real records.

Cloudflare Tunnel is an outbound connection from the host; it avoids opening an inbound application port. Cloudflare does not remove the need for application authentication, MySQL TLS, backups, secret management, and server-side authorization.

Official references: [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/), [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), [WAF](https://developers.cloudflare.com/waf/), [DDoS protection](https://developers.cloudflare.com/ddos-protection/).

## Search indexing and performance

Denge is a private authenticated app, so its document uses `noindex` metadata. Do not disallow the entire app in `robots.txt` as a replacement: crawlers need to see `noindex`. Public marketing pages, if added later, should use a separate indexable route/site.

The app defers its heavier Reports and Calendar views until selected. Keep production bundles split and avoid shipping financial data to analytics or external AI services. Monitor database query times and pool limits before increasing MySQL concurrency.
