# Clipsync — login-free QR clipboard sync

Next.js 16.4.2 / React 19.3.1 / TypeScript PWA, plus a Chrome/Edge Manifest V3 extension and encrypted WebRTC DataChannels. The existing design and optional old account workspace are preserved.

## Use

Open https://clipsync-orcin.vercel.app/dashboard/ after this release deploys. Download the extension from /downloads/clipsync-extension.zip, extract it, then Load unpacked in chrome://extensions or edge://extensions (116+).

1. Open the PC extension and choose Pair a device.
2. On the phone open Clipsync → Scan to Pair. Review the PC, request connection, compare verification codes, and confirm on the PC.
3. Enable PC clipboard capture and allow copy capture only on trusted sites. Supported copies appear automatically in the open phone app.
4. Tap Copy complete text on the phone. Optional reverse Sync Clipboard reads once after a tap; PC writes are separately opt-in.

No email, password, registration, SMTP, or end-user Supabase login is required. Camera-denied users can review the random manual pairing code instead.

## Live signaling

The deployed Supabase Edge Function uses temporary role-bound capabilities, not Supabase Auth. Its WSS endpoint is in lib/deployment.ts. The existing project stores only private expiring room metadata, hashed capabilities, rate counters, and short-lived SDP/ICE. Clipboard text travels on the DataChannel, never through a database clipboard queue.

The service survives Edge worker rotation using the shared private session store. Browser tokens remain memory-only; page reload/helper loss requires pairing again. Unused pairing credentials expire after five minutes; approved sessions after two hours. Either peer can revoke.

The extension has a fixed public manifest key for a stable unpacked ID. It is not a permanent secret or hardware identity. The server allows that exact origin and the configured website/development origins.

## Local development

Use Node 22.13+ within Node 22:

```powershell
npm ci
npm run setup:env
npm run dev
```

The default endpoint is the deployed WSS service. Public overrides: NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_SIGNALING_URL, NEXT_PUBLIC_SIGNALING_SERVICE_ID. Never place private keys in NEXT_PUBLIC_ variables.

For fully local standalone signaling, set NEXT_PUBLIC_SIGNALING_URL=ws://localhost:3012/signal, then run npm run build:signaling and npm run start:signaling in another terminal. This alternative uses in-memory sessions; it is not required for the deployed Edge service. See .env.signaling.example.

## Verify and deploy

```powershell
npm run check
npm audit --omit=dev
```

The production build creates the PWA, extension ZIP, and both Node/Edge signaling artifacts. The detailed setup/security model is in docs/QR-PAIRING.md; actual evidence and remaining real-device checks are in docs/QR-VERIFICATION.md.

The older Supabase account mode remains under Settings → Optional legacy account features. No account/auth records were destructively removed. Historical docs/DEPLOYMENT.md and docs/VERIFICATION.md apply only to that mode.

## Boundaries

Keep both peers active and online. No closed/suspended/offline delivery guarantee or universal PC/mobile clipboard monitor is claimed. Capture is opt-in, history defaults off, and optional local history is plaintext and capped at 50 entries. Restrictive networks may need a separately provisioned TURN relay; support is implemented, but live relay acceptance still needs real credentials. No native mobile app or APK/IPA is included.
