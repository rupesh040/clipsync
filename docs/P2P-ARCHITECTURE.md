# P2P architecture and implementation assessment

## Existing application

The repository is a single Next.js 16.4.2 App Router application using React 19.3.1, TypeScript, npm, Tailwind 4, Framer Motion, Lucide, React Hook Form, and Zod. Routes, design tokens, email/PKCE authentication, device pairing, settings, install controls, manifest, and offline fallback already exist. Supabase project `hdwhtaovvfiyzthfrysr` hosts account-owned devices and short-lived pairing sessions. The earlier transport sends clipboard text through a Postgres RPC and reads server history. There was no WebRTC code or browser extension. A generated `next-env.d.ts` modification was present at the start and is preserved.

## Implementation phases

1. Define a shared versioned, byte-limited protocol and validation independent of Next.js.
2. Reuse account authentication and confirmed device authorization. Add short-lived, RLS-protected SDP/ICE signaling metadata, never clipboard payloads.
3. Implement one WebRTC connection per selected counterpart, ordered DataChannels, acknowledgements, replay/echo protection, fail-closed authorization, and reconnect backoff with jitter.
4. Add a Manifest V3 desktop extension. Its service worker routes messages and owns extension storage; a DOM-capable offscreen document owns WebRTC and optional clipboard reads/writes. Supported webpage copy events are captured only on individually permitted sites.
5. Update the existing dashboard to prioritize received text, user-initiated Copy, optional local history, and explicit reverse Sync Clipboard. Keep manual sending as a secondary fallback.
6. Add server-issued short-lived coturn credentials, tests, production builds, extension packaging, and installation/security documentation. Keep actual browser/device and SMTP/TURN provisioning limits explicit.

The PWA stays a Next.js web application. There is no native mobile application, wrapper, or plugin. Supabase authenticates and exchanges connection metadata; clipboard traffic uses WebRTC, possibly through a TURN relay. Browser DataChannels encrypt their traffic in transit, but authenticated account/device metadata is not an independent hardware identity or a guarantee against a compromised account.

## Implemented data flow

Permitted webpage copy event → content script → extension worker → offscreen document → shared ClipboardPeer → ordered WebRTC DataChannel → phone ClipboardPeer → LocalClipboardStore → React useSyncExternalStore → receiver panel. The phone does not read its system clipboard to receive. The reverse Sync Clipboard action reads once after a tap; optional PC writes happen in the offscreen document.

The worker owns chrome.storage and permission checks. Chrome offscreen documents have only the runtime extension API, so authentication persistence is requested through validated worker messages. Clipboard text is never placed in extension persistent storage. Page scripts cannot issue trusted popup commands, request stored sessions, or choose a recipient. There is no externally_connectable API.

Supabase Realtime INSERT events carry SDP/ICE metadata. A fresh subscription may replay up to 128 unexpired signaling rows; this is not clipboard database polling. Device list refresh/heartbeats are metadata-only. Account-owned confirmed devices are authorized within that account; pairing is not an exclusive cryptographic relationship between two hardware keys. Each client connects to one selected counterpart at a time.

## Protocol and transport

Version 1 envelopes contain UUID message/source/destination/session IDs, timestamp, type, text, and a bounded source-origin enum. Text is limited to 16 KiB UTF-8, with a 20 KiB serialized envelope limit. Original whitespace and line breaks are preserved. Validation rejects unexpected keys, stale messages older than 120 seconds, clocks more than 30 seconds ahead, self-source, wrong peer/session, and malformed/oversized input.

Receipts acknowledge acceptance into the receiving client, not an OS clipboard write or persistence guarantee. Pending sends are bounded to 16 and expire after 10 seconds; there is no offline replay queue. A bounded 512-ID cache rejects repeated message IDs for five minutes. The extension's SHA-256 echo guard suppresses a remotely written/current value, but permits the same text again after a different local value.

The lexicographically smaller device ID offers to avoid glare. ICE candidates are bounded and queued until a matching remote description exists. Connection attempts time out after 15 seconds. DataChannel closure, ICE failure, or a four-second disconnection triggers exponential backoff with jitter; eight failed retries require manual Reconnect. New connections fetch fresh short-lived TURN credentials. STUN-only success is not assumed on restrictive networks.

Signaling loss closes delivery; authorization is rechecked with a lease of at most 10 seconds and Realtime revocation notifications. This fail-closed design favors privacy over continuing through backend outages. Device revocation cannot erase text already received. Account/session compromise requires revoking sessions/devices and may still be effective until credentials and leases expire.

## Privacy and service worker

New payloads never use the legacy clips table or send_clip RPC; its authenticated execution grant is revoked. Existing legacy data remains governed by its original expiry and can be explicitly deleted in Settings. This avoids silently destroying prior records.

The latest received text stays in memory by default. Optional account-keyed local history stores up to 50 plaintext entries; limits/expiry are enforced when loaded or updated. Sign-out clears memory, not an opted-in disk history. Storage failures emit a visible warning but do not prevent React receiving or DataChannel acknowledgement. Clear local history/site data on shared devices.

Signaling rows expire from reads after 45 seconds and physical cleanup runs every minute. SDP/ICE can expose network addresses. There is no text logging, analytics, text notification, or clipboard URL encoding. Service workers cache only public assets and do not maintain WebRTC; updates wait rather than forcibly activating over an active page. The extension and phone may suspend with browser/OS lifecycle changes.

## Evidence and limitations

Unit tests exercise protocol bounds, invalid input, duplicates, echo recovery, receipts, temporary signaling failure, revocation, Clipboard API failures, local privacy, TURN HMAC/CORS, and service-worker boundaries. The browser harness uses actual RTCPeerConnections and the actual React store, with explicitly test-only memory signaling. The PostgreSQL transaction suite separately checks real pairing/account authorization and metadata restrictions.

No physical Android/iOS installation, personal-browser extension installation, SMTP session, or real TURN relay is claimed. See DEPLOYMENT.md and VERIFICATION.md for external setup and acceptance requirements. Notification integration is not configured; clipboard text is never included in notifications.
