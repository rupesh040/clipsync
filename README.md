# Clipsync

Copy here. Paste anywhere. A Next.js App Router application with a responsive editorial landing page, workspace, authenticated Supabase integration, and browser-installable PWA.

## Current status

The source is prepared for Vercel. A new **Clipsync** Supabase project in Mumbai is provisioned, both migrations are applied, and local public connection settings are configured in ignored `.env.local`. Live SQL authorization/pairing tests passed and rolled back their test data. Email sign-in, two-browser delivery, production auth redirects, and actual mobile installation still require acceptance checks. No successful integrations are simulated. The earlier private Sites deployment is a separate, older static build; this release targets Vercel and has not overwritten it.

## Start locally

Use Node 22.13+ within Node 22:

```powershell
npm ci
npm run setup:env
npm run dev
```

Open http://localhost:3000. Without Supabase variables, the UI remains in setup mode. The environment script preserves any existing `.env.local`.

## Configure and deploy

Follow [the complete deployment runbook](docs/DEPLOYMENT.md) for Supabase project creation, migrations, email/PKCE authentication, Realtime, URL allowlists, GitHub creation/push, Vercel deployment, PWA installation, and production acceptance tests. Required public backend configuration:

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Use the public legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead of the publishable key only when needed. `.env.example` lists all supported variables, including optional local verification settings. Never put service-role keys or secrets in public variables. On a fresh project, apply the initial-schema migration then the production-hardening migration in timestamp order. Both are already installed on the connected Clipsync project; do not rerun them there. Their local timestamps match its remote migration history. If upgrading a different project that already has the legacy 001 migration, apply only the hardening migration and reconcile its CLI migration history before pushing.

## Verify

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`npm run check` combines lint, types, unit tests, and build. CI runs these commands on main and pull requests. Unit/worker tests cover payload validation, public configuration and build-time secret guards, platform instructions, manifest/icons, and service worker privacy boundaries. They do **not** substitute for real Android installation or live backend testing.

`npm run verify:backend` performs read-only live checks using your local configuration and optional test-user token. Missing setup or incomplete authenticated verification returns exit 2, not a false success. `supabase/tests/security.sql` is a transactional SQL integration suite, executed successfully on the new empty Clipsync project; all temporary test accounts and clips were rolled back. Further runs should use a dedicated test project.

## Structure

- `app/` — marketing, workspace, auth callback, and privacy routes.
- `components/` — reusable interface, pairing UI, and global install controls.
- `hooks/` — Supabase subscriptions, browser state, and clipboard workflow.
- `lib/` — validation, environment guards, Clipboard API, and install platform detection.
- `public/` — manifest, original app icons, service worker, and safe offline fallback.
- `supabase/` — local configuration, migrations, and transactional authorization tests.
- `scripts/` — safe environment bootstrap, reproducible icons, and live verification.

## Security and platform boundaries

Authentication uses email links with PKCE, persistent refreshable browser sessions, and server-validated identity. Open each sign-in link in the browser that requested it. RLS and restricted column grants isolate accounts. Pairing is short-lived, hashed, single-use, explicitly confirmed, and binds a specific joining device. Account-level transactional counters limit pairing creation and sends independently of clipboard deletion. Preferences are stored server-side; disabling history deletes stored clips atomically. Receipts are idempotent per receiving device.

Device identifiers are account-owned metadata, not independent hardware keys. A stolen account session can read that account’s data and manage devices. Revocation blocks subsequent authorized sends/receipts; sign out all sessions for account compromise. This is not end-to-end encryption. HTTPS protects transport; configure your Supabase backup/storage policies and authentication abuse controls before public launch.

History defaults off. Delivery text expires after 24 hours; opt-in history retains new clips for 1, 7, or 30 days. Expired text is excluded immediately and physically deleted hourly. No clipboard content is logged, used in analytics/notifications/URLs, or stored in browser persistent/offline caches. Displayed content exists in memory while the workspace is open and is cleared from the list when hidden; a later refresh can repopulate it only from the account backend.

The PWA uses explicit Send/Copy actions, not continuous clipboard monitoring. Mobile pages can suspend. Background clipboard synchronization requires separate native companions or an extension and OS permissions. PWA installation neither creates an APK/IPA nor removes those limitations. Offline mode provides a public fallback page and never queues clipboard text.

The build uses standard Next.js output for Vercel, including security headers and no-store service worker/auth callback responses. It no longer produces the earlier static `out/` export. No analytics, push messaging, or external app integration is configured.

Design inspiration: https://diagramdesign.dev/ — editorial hierarchy, fine dividers, whitespace, and a restrained accent. All product copy and compositions are original.
