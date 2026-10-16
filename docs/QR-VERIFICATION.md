# Login-free release verification

## Evidence

- Existing Next.js/React/PWA design, shared DataChannel protocol, local receiver, optional history, and old account mode preserved. No destructive auth/profile deletion.
- All 46 unit/worker tests pass. The reliability follow-up adds retained healthy RTC links, durable offline queues, ACK-loss retries, stale-write prevention, capability restoration, automatic retries beyond eight failures, half-open socket recovery, automatic copy observation, and MV3 alarm/access-isolation coverage. See CONNECTION-RELIABILITY.md.
- Lint/type checking, production Next.js build, Node signaling, Deno deployment sources, and MV3 ZIP build passed.
- Deployed clipsync-signal Edge Function is ACTIVE; its live /health returned readiness.
- Live database guest security transaction passed: service-role gate, consumed proof, phone cannot confirm, metadata transfer, invalid extra payload rejection, revocation, and anonymous RPC denial. Temporary test rows rolled back.
- Real browser acceptance passed against the deployed WSS endpoint: generated QR decoded by qr-scanner, login-free proof/PC confirmation, two actual RTCPeerConnections, bidirectional text/ACK, React receiving, reattachment, and revocation. No fake signaling/RTC, camera, OS clipboard, or account was used.
- Two actual production-build PWA tabs passed manual-code review, matching verification codes, PC confirmation, Connected state, multiline Unicode delivery/ACK, automatic receiver display, and disconnect/revocation.
- No horizontal overflow at 360/390/768/1024/1440px; viewport reset. Browser error logs empty.
- Runtime-only npm audit: zero vulnerabilities. Five known high-severity Next ESLint development-tool advisories remain; no forced downgrade.
- Reliability browser acceptance passed against live WSS: the same two RTC connections survived the 110-second Edge rotation, 20 offline copies automatically queued/acknowledged, helper capability restoration rebuilt RTC without a fresh QR, React displayed the result, and the session was revoked.

## Remaining physical/network acceptance

Actual Android camera/flashlight scan, native PWA installation, personal-browser extension installation/capture/clipboard permissions, real helper lifecycle, and restrictive-network TURN remain real-device checks. No universal OS clipboard monitor or closed/background delivery is claimed.

Current Edge advisors report five intentional deny-all RLS tables, ten existing account-mode definer RPC warnings, and leaked-password protection disabled (the default QR flow has no passwords).
- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

The older chatgpt.site URL is not the Vercel release. Production website: https://clipsync-orcin.vercel.app
