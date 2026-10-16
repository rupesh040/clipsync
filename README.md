# Clipsync

A Next.js PWA and opt-in Chrome/Edge extension for clipboard text delivery over WebRTC. The existing responsive interface, account authentication, confirmed pairing, themes, and install controls are preserved. No native mobile framework is used.

## What works in this release

- The PC extension detects copy events on explicitly permitted webpages. Optional desktop clipboard polling is best effort, not an OS-wide guarantee.
- An authenticated WebRTC DataChannel delivers text to the selected authorized phone/browser. Received text updates React state immediately; no paste field or reload is required.
- The phone displays complete multiline text, source, time, and a user-initiated Copy button with a manual-selection fallback.
- Optional Sync Clipboard reads the phone clipboard only after a tap. The extension can write received text to the PC clipboard when enabled and supported.
- Pause, disconnect, reconnect, direction controls, bounded deduplication/echo protection, acknowledgements, and optional local history are included.

## Start and build

Use Node 22.13+ within Node 22:

```powershell
npm ci
npm run setup:env
npm run dev
```

Open http://localhost:3000. Without valid public Supabase configuration the app stays in setup mode. The setup script never overwrites an existing .env.local.

```powershell
npm run check
npm start
```

The check runs lint, type checking, unit/worker tests, and the production build. The prebuild also creates the extension in extension/dist and its downloadable ZIP at public/downloads/clipsync-extension.zip. For extension-only packaging use npm run build:extension.

## Deployment and pairing

Follow [the deployment runbook](docs/DEPLOYMENT.md) for Vercel variables, Supabase SMTP/email OTP, exact auth redirects, extension installation, pairing, short-lived TURN credentials, and acceptance checks.

Public configuration: NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY). Server-only TURN configuration and the exact extension-origin allowlist are documented in .env.example. Never expose service-role keys or permanent TURN secrets.

The connected Mumbai Supabase project has all three timestamped migrations applied, including authenticated SDP/ICE signaling and revocation of the legacy clipboard-upload RPC. Do not reapply them there. A new environment needs all migrations in timestamp order.

## Privacy and platform boundaries

Clipboard payloads travel through the DataChannel, directly or through a TURN relay, not through a Supabase clipboard queue. Supabase retains account/device metadata and short-lived SDP/ICE, which can reveal network addresses. DataChannels encrypt transport; this is not independent hardware identity or protection against an account/service compromise.

History is off by default; received text stays in memory. Optional history stores up to 50 plaintext entries locally for 1, 7, or 30 days. Expired entries are pruned when the app is used, not by a background OS deletion guarantee. Disabling local history removes saved entries. Old cloud records are not silently migrated: Settings provides an explicit legacy-cloud deletion action; existing server expiry/cleanup remains active.

Both peers must be active, authorized, and online. Mobile browsers can suspend. No delivery is promised while the phone is closed, suspended, or offline. No offline clipboard queue, native Android app, APK/IPA, push notification, or universal system clipboard monitor is included. Service-worker updates wait rather than forcibly activating over a live connection.

## Verification and release status

See [verification evidence and remaining acceptance checks](docs/VERIFICATION.md) and [architecture/security details](docs/P2P-ARCHITECTURE.md). Automated tests and a real-browser WebRTC loopback passed; real extension-to-phone, mobile installation, and restrictive-network TURN acceptance remain pending. Production SMTP and deployment credentials/settings still require account-owner configuration. The older private Sites URL is not this release and has not been overwritten.

## Structure

- app/, components/, hooks/, lib/: existing PWA and receiver UI.
- packages/protocol/: shared versioned, runtime-validated message protocol.
- packages/transport/: WebRTC manager, authenticated signaling, ICE configuration.
- extension/: Manifest V3 worker, offscreen bridge, popup, and permitted-site capture.
- supabase/: three migrations and transactional security tests.
- scripts/, tests/, docs/: repeatable packaging, verification, browser harness, and runbooks.

Design inspiration: https://diagramdesign.dev/ — original compositions retaining the existing editorial hierarchy and restrained accent.
