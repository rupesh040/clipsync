# Clipsync PWA + PC extension deployment

## Release state

The existing Next.js application is preserved. Supabase project hdwhtaovvfiyzthfrysr in rupesh's projects, Mumbai (ap-south-1), is configured locally with public credentials in ignored .env.local. All three migrations are applied there. The P2P database security suite passed and rolled back temporary data.

This release has not been deployed to Vercel or pushed to a GitHub remote. The earlier niftyfig.chatgpt.site URL is an older, separate static build. Browser loopback tests are not proof of real extension-to-phone operation. Production SMTP, real-device installation, and TURN relay acceptance remain required.

## 1. Local setup and variables

Use Node 22.13+ within Node 22, then:

```powershell
npm ci
npm run setup:env
npm run dev
```

Open http://localhost:3000. setup:env preserves existing values. Do not commit .env.local.

| Variable | Exposure | Purpose |
| --- | --- | --- |
| NEXT_PUBLIC_SITE_URL | Public, build time | Canonical app origin; local http://localhost:3000 or production HTTPS |
| NEXT_PUBLIC_SUPABASE_URL | Public, build time | Existing Supabase project URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Public, build time | Public publishable key |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Public, build time | Legacy anon alternative; leave empty with publishable key |
| EXTENSION_ORIGINS | Server only | Comma-separated exact chrome-extension:// IDs allowed to request ICE credentials |
| STUN_URLS | Server only configuration | Comma-separated stun:/stuns: URLs; defaults to Google STUN |
| TURN_URLS | Server only configuration | Comma-separated turn:/turns: URLs for your relay |
| TURN_SHARED_SECRET | Secret, server only | coturn REST shared secret; never NEXT_PUBLIC_ |
| TURN_TTL_SECONDS | Server only | Credential lifetime 60–3600 seconds; default 600 |
| SUPABASE_PROJECT_REF | Local optional | CLI project reference, not read by the app |
| CLIPSYNC_VERIFY_ACCESS_TOKEN | Local optional secret | Disposable test user's short-lived session; never Vercel/Git |

Public values are embedded in the website and extension. Changing them requires rebuilding/redeploying. Never place a service-role key, database password, SMTP password, or permanent TURN credential in client code. No privileged Supabase key is needed by the Next.js route.

## 2. Supabase and email sign-in

For an entirely new project apply these migrations once, in order:

1. 20261016063144_clipsync_initial_schema.sql
2. 20261016063158_clipsync_production_hardening.sql
3. 20261016074733_clipsync_p2p_signaling.sql

The connected project already has these; do not reapply them. For CLI deployment inspect supabase --help, sign in, link the intended project, inspect migration history, and push only pending migrations. Back up populated projects before upgrades. Do not use db reset on production.

Confirm pgcrypto, pg_cron, device Realtime publication, and rtc_signals publication. The hourly clipsync-expiry job handles legacy content; clipsync-signaling-expiry runs every minute. Signaling rows expire from client reads after 45 seconds. Pairings and private rate limits have no direct client read access.

In hosted Authentication settings:

- Enable Email and the intended signup policy. Configure a production SMTP provider and verified sender. The prior live request returned 429 over_email_send_rate_limit; changing Vercel redirects alone cannot fix email delivery limits.
- Set Site URL to the final production HTTPS origin.
- Add exact redirect URLs: http://localhost:3000/auth/callback/ and https://YOUR_HOST/auth/callback/. Add only trusted preview origins individually.
- Edit the Magic Link email template to contain both the numeric `{{ .Token }}` and link `{{ .ConfirmationURL }}`. The PC extension uses numeric email OTP. The website also supports entering the OTP, useful when an installed PWA opens email links in a different browser.
- Open PKCE links in the browser context that requested them; otherwise use the numeric OTP in the originating app. Do not use a pairing code as an email OTP.
- Review token rotation, session lifetimes, signup abuse controls, and rate limits. Local supabase/config.toml does not configure hosted Auth automatically.

After SMTP changes, wait for any existing rate-limit window, request one fresh message, then verify it. Supabase Auth logs distinguish provider/recipient restrictions, rate limits, and SMTP failures. No delivery success should be inferred from a configured public key.

## 3. GitHub and Vercel

1. Create an empty private GitHub repository under the intended owner. Existing local Git history is preserved; do not initialize a conflicting remote or force-push. Inspect git status and git remote -v, review/commit the new changes yourself, then push to the verified destination.
2. Import that repository into Vercel. Use Next.js, repository root, Node 22.x, npm ci, and npm run build. Leave Next.js Output Directory at its default, not out/.
3. Add public variables from section 1. Add the server-only TURN variables and EXTENSION_ORIGINS as applicable. Never add the disposable verification token.
4. Deploy, obtain the actual assigned production origin, set NEXT_PUBLIC_SITE_URL to it, update Supabase Site URL/callback URLs, and redeploy. No specific Vercel hostname is assumed.
5. Verify /, /dashboard/, /devices/, /history/, /settings/, /help/, /login/, /signup/, /privacy/, /auth/callback/, /manifest.webmanifest, /sw.js, and /downloads/clipsync-extension.zip. The worker must return JavaScript, no-store, and nosniff.

The ICE endpoint is POST /api/rtc-config. It requires a bearer session, an authorized account-owned device ID, and an exact same-app or allowed extension Origin. OPTIONS is also origin-restricted. Responses are no-store; credentials expire and are regenerated for fresh connections. Missing TURN does not fabricate a working relay: the UI warns that restrictive networks can fail.

## 4. TURN fallback

Provision a coturn-compatible relay with HTTPS/TLS certificates where appropriate, public reachability, and UDP/TCP/TLS relay ports allowed by your firewall. Enable coturn's REST shared-secret authentication (use-auth-secret / static-auth-secret / realm) with the same private secret as TURN_SHARED_SECRET. Keep server and clients' clocks accurate.

Example placeholder configuration:

```dotenv
TURN_URLS=turn:relay.example.com:3478?transport=udp,turns:relay.example.com:5349?transport=tcp
TURN_SHARED_SECRET=REPLACE_WITH_A_STRONG_SERVER_ONLY_SECRET
TURN_TTL_SECONDS=600
```

Do not copy that placeholder to production. Use your own TURN hostname and secret. Credentials are HMAC-SHA1 coturn REST values tied to expiry, user, and device. They are delivered only after session/device validation and a per-device issuance limit. This project does not provision a paid TURN service or claim that STUN-only connectivity works everywhere.

On a staging test, temporarily force iceTransportPolicy: relay in the connection factory, use two separate networks, and inspect selected candidate stats for relay. Remove the staging override after verifying both directions, reconnect, and expiry/new credentials. This live relay test has not been completed.

## 5. Build and install the PC extension

```powershell
npm run build:extension
```

The output is extension/dist and public/downloads/clipsync-extension.zip. Production npm run build runs this automatically. The ZIP includes only built extension assets, public project configuration, and manifest/icons, not .env.local or permanent secrets.

1. On desktop Chrome or Edge 116+, open chrome://extensions or edge://extensions.
2. Enable Developer mode. Load unpacked → extension/dist, or extract the ZIP and select its manifest.json folder.
3. Open the popup. Copy the displayed chrome-extension:// origin into the Vercel server-only EXTENSION_ORIGINS allowlist and redeploy. Unpacked IDs can differ by machine/path, so use the actual displayed ID.
4. Set the popup's app origin to the deployed canonical HTTPS origin and approve only that host permission. Production-built downloads default to the production origin.
5. Sign in using the same email as the phone. Request a code and enter the numeric email OTP.
6. Leave clipboard capture disabled until pairing succeeds. Enable only the capture capabilities you intend to use.
7. On an ordinary trusted webpage, choose Allow copy capture on current site and approve that specific origin. Existing pages receive the content script immediately; future pages use registered scripts. Revoke unwanted site permissions in browser extension settings.
8. Optional desktop reads poll only while enabled, not paused, and explicitly opted in. Optional PC writes replace the system clipboard when the browser permits them.

No extension was installed into your personal browser automatically. This is an unpacked development distribution, not a Chrome Web Store publication or signed store package. Browser/internal/store pages and all desktop applications are not universally capturable. The service worker routes storage/messages; an offscreen DOM document owns WebRTC and clipboard operations. Browser shutdown/suspension can terminate either.

## 6. Pair and use

1. Generate a five-minute code in the PC extension.
2. On the phone, sign in to the same account and open Connect a device. Name the phone, continue, enter the PC code, and request connection. The phone creates its own pending identity before joining.
3. Confirm in the extension; choose Verify connection on the phone. Expired/canceled/consumed codes cannot authorize devices. A joining device must finish within its registration window.
4. Enable the PC bridge; select the phone. In the PWA select the PC counterpart. One counterpart is supported per client at a time.
5. Keep both active. Copy non-sensitive multiline text on a permitted PC webpage. Wait for Connected and receipt status; text should appear automatically in the phone receiver without an input field.
6. Tap Copy complete text on the phone. Success appears only after the API resolves. If denied, use Select text and the system copy menu.
7. For phone → PC, leave direction Both (or Send), tap Sync Clipboard to PC, and grant the supported clipboard read. Enable PC writes for automatic PC replacement, or use Show last text / Copy last received in the popup.
8. Test pause, resume, disconnect, reconnect, and revocation. Device revocation closes via Realtime and periodic authorization checks; it is not instantaneous remote deletion of previously received text.

The initiator must retain its pairing code until confirmation. Closing a dialog does not magically revoke its code; Cancel pairing invalidates the available initiating code, otherwise it expires. If a joining request is abandoned, it expires naturally. Copying to the OS clipboard is distinct from transport acknowledgement.

## 7. PWA installation, storage, and offline

Android Chrome: open the production HTTPS site, choose Install App or browser menu → Install app / Add to Home screen. Launch the icon, sign in inside that context, and test live delivery. iOS/iPadOS Safari: Share → Add to Home Screen; browser and installed-app sessions can differ. Use numeric email OTP when needed. Desktop installation is optional. Declining the install prompt does not claim success.

The worker caches only public offline assets and immutable Next static files. It excludes auth callbacks, API responses, Supabase traffic, signed-in navigation, and clipboard text. An offline screen is not an offline clipboard queue. Updates wait until old clients release the worker; no unconditional skipWaiting interrupts a DataChannel.

History defaults off. Opting in saves up to 50 plaintext entries to account-keyed localStorage for 1/7/30 days, pruned on app use. Sign-out clears in-memory text but intentionally does not delete opted-in history. Clear local history or browser site data on a shared device. Legacy cloud content has a separate explicit deletion action in Settings; disabling local history does not silently delete old server records.

## 8. Verification and acceptance

```powershell
npm run check
npm audit --omit=dev
npm run verify:backend
```

The backend script is read-only and exits 2 when configuration or an authenticated test session is missing. It never prints tokens or text. It does not replace two-device acceptance.

In a dedicated test project, execute supabase/tests/security.sql as the database administrator with errors stopping execution. It creates temporary accounts, checks pairing/expiry/isolation, rejects clipboard uploads through the legacy RPC, checks metadata authorization/revocation/expiry, then rolls back. Close/rollback the session after any interrupted failure.

The browser transport harness is deliberately separate from production routes:

```powershell
node scripts/build-p2p-harness.mjs ABSOLUTE_SCRATCH_DIRECTORY
node scripts/serve-p2p-harness.mjs ABSOLUTE_SCRATCH_DIRECTORY
```

Open http://localhost:3011 and run the check. It uses two actual RTCPeerConnections, an explicitly test-only in-memory signaling bus, and the actual React external store. It proves browser transport/state, not Supabase login, a phone, or TURN.

Before production sign-off test actual Chrome/Edge extension → Android PWA, reverse reads/writes, iOS if supported, permission denial, long Unicode text, duplicate/echo protection, airplane mode/recovery, background suspension, expired pairing, device revocation, and restrictive-network TURN. See VERIFICATION.md for what was actually run.

## Official references

- https://developer.chrome.com/docs/extensions/reference/api/offscreen
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://supabase.com/docs/guides/realtime/postgres-changes
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/redirect-urls
- https://nextjs.org/docs/app/guides/progressive-web-apps
- https://vercel.com/docs/frameworks/full-stack/nextjs
