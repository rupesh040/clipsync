# QR pairing and production deployment

## Current architecture

The existing Next.js App Router PWA, Tailwind/Framer Motion styling, Lucide icons, shared ClipboardPeer, receiver panel, optional local history, PWA manifest/service worker, and PC extension are preserved. Account-based pairing is retained separately as an optional legacy mode; the default QR flow does not initialize or depend on end-user Supabase Auth.

Production website: https://clipsync-orcin.vercel.app
Signaling: wss://hdwhtaovvfiyzthfrysr.supabase.co/functions/v1/clipsync-signal/signal
Readiness: https://hdwhtaovvfiyzthfrysr.supabase.co/functions/v1/clipsync-signal/health

The signaling service is deployed in the existing Supabase project. No Render account or additional hosting service is required. The Node + ws service remains an optional local/self-hosted alternative, not a second mandatory backend.

## Pairing and authorization

1. The PC requests a session from the configured endpoint. The server generates random session/device UUIDs, a 256-bit QR secret, a separate 256-bit host token, a random 48-bit manual code, and a five-minute expiry.
2. Strict, versioned QR JSON contains only service ID, temporary session/secret, expiry, and device name. No endpoint URL, permanent device token, private API key, or clipboard text is trusted from a QR.
3. The phone validates the QR locally, inspects the proof through the configured server, reviews session details, and explicitly requests connection. Manual codes use the same review step.
4. Joining consumes both QR/manual proof atomically and creates one pending phone with its own temporary token. Replays, expired codes, and wrong proofs fail.
5. Compare the random verification code on both screens. Only the initiating PC may confirm the phone. Device names are self-reported, not identity proof.
6. Approval authorizes exactly those two device IDs for at most two hours. Each signaling/configuration/authorization/revoke request carries the temporary role token and must match its socket binding.
7. Reconnection reattaches the capability and supersedes an older socket for that role. Approved capabilities are retained only in local browser-session recovery storage, never URLs or QR history. Reopening a second copy of the same restored session can supersede its older socket; independently paired tabs remain separate.
8. Either peer can revoke. Local transport stops immediately. Connected Edge peers learn revocation through the next metadata check, normally about a second; network delays and the transport's short authorization lease apply. If the server cannot confirm, the UI does not claim successful remote revocation.
9. Approved, unexpired sessions and pending transfers resume from PWA sessionStorage or extension chrome.storage.session after supported reload/helper restoration. Healthy RTC channels survive WSS rotation. These stores are browser-session scoped, not indefinite remembered pairing. See CONNECTION-RELIABILITY.md.

A stolen QR can request its one join; a stolen device token can use that role until expiry/revocation. Keep codes private and approve only devices in front of you. Encrypted WebRTC transport is not protection against a compromised client or signaling service.

## Deployed Edge service

server/edge.ts implements the same wire protocol as the local Node service. Build with npm run build:signaling. It produces server/dist/edge-source containing compact Deno sources, a pinned Zod import map, and the public extension identity for deployment.

The deployed function has verify_jwt=false because browser WebSockets cannot send arbitrary Authorization headers and users do not sign in. This does not make session operations unauthenticated: bootstrap needs one-time proof, and every later frame validates a role-bound temporary capability. The service-only database dispatcher additionally validates the platform service role.

Private guest_rooms, guest_events, and guest_rates tables are RLS-enabled and deny direct anon/authenticated access. Only a service-role RPC can operate them; runtime credentials are automatically supplied to the Edge Function and are never bundled into either client.

All five timestamped migrations are applied to the connected project. New guest migrations are:
- 20261016104807_clipsync_guest_sessions.sql
- 20261016105119_clipsync_guest_validation_fix.sql

New environments apply all migrations in order. Do not reapply them to this project. The companion transactional guest-security.sql suite tests role grants, single-use proof, PC-only confirmation, metadata routing, payload restrictions, revocation, and anonymous RPC denial, rolling test records back.

Room metadata and capability hashes expire after the session window. SDP/ICE rows expire after 45 seconds; minute cleanup removes expired rows/counters. Supabase backup/retention policies still govern infrastructure copies. No clipboard payload table or account/profile dependency is added.

The server checks private metadata about once a second to coordinate sockets across Edge isolates, then forwards changes over WSS. This is signaling metadata coordination, not polling a clipboard database to fake P2P delivery. Actual clipboard text uses the browser DataChannel. The implementation is intended for small deployments; metadata polling and hosted function/database quotas require capacity review before high-volume public use.

Edge workers rotate/terminate under platform limits. The server proactively closes after 110 seconds; client backoff reconnects and reattaches the shared session. No permanent worker is assumed. Origin checks and socket/request/buffer/time limits supplement capability authorization; Origin alone is never identity because non-browser clients can forge it.

## Public configuration

Current defaults are in lib/deployment.ts; explicit NEXT_PUBLIC_ settings can override them:

```dotenv
NEXT_PUBLIC_SITE_URL=https://clipsync-orcin.vercel.app
NEXT_PUBLIC_SIGNALING_URL=wss://hdwhtaovvfiyzthfrysr.supabase.co/functions/v1/clipsync-signal/signal
NEXT_PUBLIC_SIGNALING_SERVICE_ID=clipsync
```

No public key or Supabase browser session is needed by the QR protocol. The old NEXT_PUBLIC_SUPABASE_* values remain only for optional account mode. No SMTP setup is required.

The extension public identity in extension/identity.json fixes its unpacked ID at nmenendmjdolkgpihfbemokkekjfdadn. The manifest key is public and is not used to sign messages. Its origin is explicitly allowed in server/edge.ts, along with the production app and localhost QA origins. If moving domains or intentionally changing extension identity, update/redeploy the allowlist and rebuild both clients. Never use a wildcard allowlist.

## TURN

STUN defaults to Google's public endpoint. For restrictive networks configure the following as server-only Edge secrets, never NEXT_PUBLIC_:

- TURN_URLS: your actual turn:/turns: relay URLs.
- TURN_SHARED_SECRET: matching coturn REST shared secret.
- TURN_TTL_SECONDS: 60–3600 seconds, default 600.
- STUN_URLS: optional comma-separated STUN override.

The function issues short-lived HMAC-SHA1 coturn REST credentials only to an approved session. Provision relay DNS/TLS/firewall and test relay-forced staging traffic over separate networks. No TURN credentials/service have been fabricated or a paid relay purchased. The app warns when relay is not configured.

## Website/extension release

1. Push the approved source to rupesh040/clipsync main. The connected Vercel deployment should build with Node 22.x, npm ci, npm run build, normal Next.js output (not out/).
2. Verify the production origin serves the login-free workspace. Ensure old environment overrides do not point to a local or stale signaling URL.
3. Download /downloads/clipsync-extension.zip from that deployed origin. Extract and Load unpacked using Chrome/Edge 116+.
4. Open the popup, generate a pairing QR, scan from the phone PWA, review/confirm both screens, then enable PC clipboard capture. Individual site permissions are requested only for chosen trusted sites.
5. Keep both active; text appears in the phone receiver without a receiving input. Copy complete text uses a tap; reverse reads/writes are separately user-initiated/opt-in.
6. Test Android installation, real camera/flashlight behavior, extension permissions/lifecycle, and cross-network TURN. Automated/browser-tab evidence does not replace those tests.

Vercel now supports WebSocket Functions, but this release deliberately deploys its signaling on Supabase with shared private state instead of assuming an in-memory Vercel function is a durable room coordinator. No additional Vercel WebSocket function is configured.

## Optional standalone server

For local/self-hosted operation, npm run build:signaling creates server/dist/index.cjs. Supply the settings in .env.signaling.example and npm run start:signaling. The dev:signaling command can read ignored .env.signaling. Set the public endpoint to your actual WSS /signal host and rebuild; plain WS is accepted only on localhost.

This alternative holds rooms in bounded RAM, so its server restart loses sessions. One persistent instance is required; do not add replicas without shared coordination. The Dockerfile is included for this option. Public values must use real TLS endpoints; a phone cannot reach the PC via the phone's own localhost.

## Camera, clipboard, and PWA boundaries

qr-scanner decodes camera frames locally using BarcodeDetector or its bundled worker. Permission starts only after Scan to Pair. Scanning frame, supported flashlight, manual-code review, and stop/destroy/track cleanup on scan/cancel/hide/pagehide/unmount are implemented. No camera frames are uploaded.

The phone does not need clipboard-read permission to receive. Copy confirms success only after API completion and offers selection fallback. The PC extension never promises universal application monitoring. Its offscreen document owns WebRTC/clipboard operations; the recovery alarm can recreate a missing helper while unexpired browser-session credentials survive. Full browser restart or discarded recovery storage requires pairing again.

History defaults off; optional plaintext browser history is limited to 50 entries and 1/7/30-day pruning when loaded/changed. No text logs or notifications. Service-worker caching excludes sessions, clipboard/API data, and signed-in pages; updates wait instead of forcibly interrupting a live page. Closed, suspended, or offline delivery is not guaranteed.

## Primary references

- https://supabase.com/docs/guides/functions/websockets
- https://supabase.com/docs/guides/functions/examples/resumable-websockets
- https://vercel.com/docs/functions/websockets
- https://github.com/nimiq/qr-scanner
- https://github.com/soldair/node-qrcode
- https://developer.chrome.com/docs/extensions/reference/manifest/key
