# Verification and release status

## Current automated evidence

- ESLint: zero warnings; generated extension bundles are excluded, not lint-rule exceptions.
- TypeScript: Next route generation and strict type checking passed for web, shared transport, extension, and tests.
- Unit/worker tests: all 24 passed, including storage failure not blocking live receiving, repeat-copy echo recovery, and cancellation during asynchronous authorization/signaling setup.
- Production Next.js build and Manifest V3 bundling/ZIP generation passed.
- Real-browser harness: two actual RTCPeerConnections delivered original multiline Unicode text in both directions, received acknowledgements, updated the actual React useSyncExternalStore receiver, and reconnected. Console errors were empty. Signaling was an explicitly test-only memory adapter; no real account or phone was involved.
- Live Supabase transactional P2P suite passed: confirmed account-owned pairing, expired/consumed-code rejection, signal authorization, cross-account rejection, revocation, expiry visibility, forbidden extra payloads, and rejection of the old clipboard-upload RPC. Temporary test data rolled back.
- Runtime npm audit: zero vulnerabilities; the full development audit reports five high-severity findings described below.
- Production HTTP checks: all 16 checked application/static/download paths returned 200. Service worker is JavaScript with no-store; the extension download is application/zip.
- ICE endpoint access-control checks: same-origin unsigned POST returned 401; untrusted-origin POST/OPTIONS returned 403; same-origin preflight returned 204.
- Receiver layout has no horizontal overflow at 360, 390, 768, 1024, and 1440px. Viewport override was reset. Browser console error list was empty.
- Read-only backend verification reached live Auth, then correctly reported authenticated session checks pending (exit 2); no test-user token was supplied.
- Previously verified PWA manifest/icons, safe offline worker caching, no signed-in/API caching, and desktop layouts remain regression-tested. Actual OS installation is not implied by these tests.

## Configuration applied

Supabase project hdwhtaovvfiyzthfrysr is in rupesh's projects, Mumbai. All three timestamped migrations are installed, including 20261016074733_clipsync_p2p_signaling. Its local filename matches the remote migration history. Public connection values are present only in ignored .env.local.

New clipboard data does not use the database. The legacy send_clip grant is revoked from authenticated clients. Account/device metadata and short-lived SDP/ICE use Supabase. Local history defaults off; the existing database cleanup remains for legacy records. No real clipboard examples or user sessions were seeded.

## Still required externally

1. Production SMTP and email template containing both numeric Token and ConfirmationURL. Prior built-in mail delivery returned 429 over_email_send_rate_limit. The OTP UI and clearer errors do not by themselves configure the provider.
2. GitHub destination/review/commit/push and a real Vercel deployment with canonical origin, exact Auth callbacks, and extension-origin allowlist. No new commit or Vercel deployment is claimed.
3. Real PC Chrome/Edge extension installation and email sign-in, pairing with a physical Android phone, automatic permitted-site copy delivery, phone Copy, optional reverse sync, and permission-denied fallbacks.
4. Real mobile PWA installation, standalone email OTP, offline reopening, background suspension/recovery, and service-worker update behavior.
5. A provisioned TURN service, private shared secret, firewall/TLS configuration, and relay-forced cross-network acceptance. No TURN service/credentials were supplied, so relay fallback is implemented but not live-tested.
6. Actual Chrome offscreen clipboard permissions/lifecycle checks on target OS/browser. The extension does not promise monitoring of every PC application or a closed browser.

See DEPLOYMENT.md for the executable runbook and acceptance matrix.

## Dependency and advisor notes

Runtime dependencies were audit-clean. Five high-severity development-tool advisories remain in Next ESLint's fast-glob → micromatch → braces chain; the suggested automatic major-version downgrade was not applied. Track https://github.com/advisories/GHSA-vfj7-8cjw-p6xm. Some lint dependencies still declare ESLint 9 peer metadata while this project uses ESLint 10.

The live security advisor reports two intentional deny-all pairing/private-rate-limit tables and ten authenticated SECURITY DEFINER RPCs. The functions require explicit account/device checks and restricted grants; private helpers are not client-executable. These are not independent hardware-key authentication. It also reports leaked-password protection disabled; current UI is email OTP/link-only, but review this hosted setting before enabling password authentication.

- [Deny-all RLS tables](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Authenticated definer RPC review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
