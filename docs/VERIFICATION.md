# Verification and release status

## Local release checks

- Clean `npm ci`: passed; dependency peer/advisory warnings are documented below.
- `npm run lint`: passed with zero warnings, without disabling React/Next lint rules.
- `npm run typecheck`: passed.
- `npm test`: all 12 tests passed.
- `npm run build`: passed, including the public-credential prebuild guard.
- `npm audit --omit=dev`: zero runtime vulnerabilities.
- Production server: all 11 application/auth routes plus manifest, worker, offline page, and 192/512px icons returned HTTP 200. Manifest and worker content types are correct; `/sw.js` returns `Cache-Control: no-store` and `nosniff`.
- Desktop browser: the configured project shows sign-in required, not a fake connected session. Install App opened accessible desktop fallback instructions; dismissing returned focus to its button. No browser console errors were captured.
- Dashboard and install control: no horizontal overflow at 360, 390, 768, 1024, and 1440px. The explicit viewport override was reset after checking.
- Mobile/native install and browser service-worker offline execution remain acceptance items; VM-based worker tests and served assets do not prove an OS installation.

## Completed configuration

- Preserved the existing Next.js interface and routes; added PKCE callback, environment validation, install UI, original PWA icons, manifest, privacy-preserving service worker, and offline fallback.
- Added ESLint, repeatable Node 22 setup, a lockfile-verified install, CI, build-time rejection of public secret credentials, unit/worker tests, and Vercel configuration.
- Created the **Clipsync** Supabase project in **rupesh's projects**, **Mumbai / ap-south-1**, reference `hdwhtaovvfiyzthfrysr`.
- Applied `20261016063144_clipsync_initial_schema` and `20261016063158_clipsync_production_hardening`. Local migration filenames match the remote migration history.
- Configured the project URL and public publishable key in ignored local `.env.local`; `.env.example` contains no real credentials.
- Verified RLS on all six application tables, an active hourly cleanup job, schema version 2, and `devices`, `clips`, and `profiles` in the Realtime publication.
- Executed the real PostgreSQL transaction suite successfully, including account isolation, explicit device pairing, unapproved/revoked device rejection, direct-authorization rejection, per-device receipt idempotency, self-receipt rejection, rate limiting despite deletion, expiry filtering, and disabling history. All temporary test accounts, clips, and devices rolled back. The application remains empty, not seeded with demo data.
- Reached the live Supabase Auth endpoint using public project configuration. An end-user email session and browser Realtime delivery are not yet verified.

## Required account actions

1. **GitHub:** the connector authenticated as `rupesh040`, and a focused search found no Clipsync repository. Its tools do not create repositories; the browser is at GitHub sign-in. Create an empty private repository and push the committed `main` branch using the runbook. No GitHub repository URL or pushed branch is claimed yet.
2. **Vercel:** connection remains pending. Import the repository, set production public environment variables, and deploy. No Vercel production URL exists yet. The earlier `niftyfig.chatgpt.site` URL is a separate older deployment and is not a Vercel deployment of these changes.
3. **Supabase dashboard:** the connected database tools do not expose hosted Auth settings, and dashboard access requires login. Set the production Site URL, exact `/auth/callback/` redirect URLs, SMTP, session/security settings, and email rate limits as described in the runbook. The local TOML does not apply these hosted settings automatically.
4. **Acceptance:** verify email sign-in in the originating browser, actual two-browser send/copy in both directions, Android native install, iOS Add to Home Screen/standalone launch, and real device offline behavior. Desktop layout checks and unit-tested service worker logic do not substitute for these checks.

## Dependency and advisor findings

The runtime-only npm audit reports **zero vulnerabilities**. The full audit reports **five high-severity development-tool findings** in the Next ESLint → fast-glob → micromatch → braces chain. The suggested automatic fix downgrades the Next lint configuration across major versions; it was not applied. Track the [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) before declaring the whole toolchain advisory-free. ESLint 10 runs successfully with the current Next config; some included plugins still publish ESLint 9 peer metadata, producing npm peer warnings during installation.

The Supabase security advisor reported two intentional deny-all tables without direct policies (`pairings` and private rate limits), plus nine authenticated SECURITY DEFINER RPC notices. These functions are intentionally exposed for bounded account-owned operations, have empty search paths and explicit identity/ownership checks, and are tested through database roles. Private helper functions revoke client execution. They are not claims of independent hardware/device-key authentication. Review [RLS enabled without a policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [authenticated SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) when changing this authorization design.

## Install and privacy contract

Install App requests the browser’s native prompt only after it is available. Otherwise it presents Android, iOS/iPadOS, or desktop instructions. An accepted prompt says only that installation was requested; the UI hides after `appinstalled` or standalone detection. Declining does not fake success. Clipboard data, auth codes, API responses, and signed-in navigation are excluded from the offline cache. No APK/IPA is produced, and installation does not permit unrestricted background clipboard access.
