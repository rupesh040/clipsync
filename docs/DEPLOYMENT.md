# Supabase, GitHub, and Vercel runbook

The local application can run in setup mode without credentials. A new Clipsync project is now provisioned in `rupesh's projects`, region `ap-south-1` (Mumbai), project reference `hdwhtaovvfiyzthfrysr`. Both migrations, RLS, Realtime publication, and the hourly cleanup job are installed. Local public variables are configured in ignored `.env.local`. Transactional SQL tests passed and rolled back all test data. The Auth API is reachable; a real email session, production redirects, and two-browser delivery are still pending. The following fresh-project instructions remain useful for another environment; do not recreate or remigrate the configured project.

## 1. Local setup

Run these commands from the Clipsync repository root (the directory containing package.json):

```powershell
npm ci
npm run setup:env
npm run dev
```

Open http://localhost:3000. The environment setup command never overwrites an existing `.env.local`. Use Node 22.13 or later in the Node 22 line. Generated icons are committed; regenerate them with `npm run icons` if the mark changes.

## 2. Create Supabase

1. At https://supabase.com/dashboard create a project in your organization. Choose a region near your users and set a strong database password in your password manager. Account selection, billing, and database credentials are manual actions.
2. Open Project Settings → API (or the project Connect dialog) and copy the Project URL and **publishable key** into `.env.local`. A legacy **anon** key is also supported. Never put a secret or service-role key in a `NEXT_PUBLIC_` variable. Do not paste credentials into chat or Git.
3. In Database → Extensions, enable `pgcrypto` and `pg_cron`. For a fresh project, execute `supabase/migrations/20261016063144_clipsync_initial_schema.sql`, then `20261016063158_clipsync_production_hardening.sql`, in that order. Run each migration once. If the legacy 001 schema was already applied in a different project, apply only production hardening and reconcile its migration history. Preserve existing data and take a backup before upgrading a populated project. Both timestamped migrations are already applied to the connected Clipsync project.
4. Alternatively, with the official Supabase CLI installed, run `supabase login`, `supabase link --project-ref YOUR_PROJECT_REF`, then `supabase db push`. Supply the database password only through the CLI’s local interactive prompt. Do not apply the same migration through both SQL Editor and CLI unless you reconcile its migration history using the CLI’s migration repair command.
5. In Authentication → Providers → Email, enable email signup and email confirmations. Configure a production SMTP provider; Supabase’s development mail restrictions are unsuitable for a public launch. Keep the default magic-link template using `{{ .ConfirmationURL }}`. The application uses PKCE and exchanges the returned code on `/auth/callback/`.
6. In Authentication → URL Configuration, set Site URL to your production HTTPS origin after Vercel assigns it. Add the **exact** URLs `http://localhost:3000/auth/callback/` and `https://YOUR_PRODUCTION_HOST/auth/callback/` to Redirect URLs. Add each trusted preview origin explicitly if you need preview authentication. Avoid broad production wildcard allowlists.
7. In Authentication settings, enable refresh-token rotation and review session expiration, signup abuse controls, and email rate limits. Local defaults are in `supabase/config.toml`; they do **not** automatically configure the hosted project. Apply hosted settings in its dashboard. Configure CAPTCHA if abuse requires it; this release does not have a CAPTCHA widget configured.
8. Under Database → Replication / Realtime, confirm `devices`, `clips`, and `profiles` are in `supabase_realtime`. The migrations add them. Ensure the public schema is exposed to PostgREST. Pairings and rate limits deliberately have no direct client read grants.
9. Check `select jobname, schedule, active from cron.job where jobname='clipsync-expiry';` and confirm the hourly cleanup job is active. Review `cron.job_run_details` after its first scheduled run. Expired clips are excluded immediately by RLS; physical deletion happens hourly. Do not disable cleanup without an alternative retention job.

### Environment values

| Variable | Where | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Local and Vercel | Local origin or the final canonical HTTPS production origin; no trailing path |
| `NEXT_PUBLIC_SUPABASE_URL` | Local and Vercel | The Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Local and Vercel | Preferred public publishable key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Local and Vercel, only if using legacy keys | Alternative public anon JWT; leave blank when using the publishable key |
| `SUPABASE_PROJECT_REF` | Local CLI reference, optional | Project identifier used for linking the CLI; the application does not read it |
| `CLIPSYNC_VERIFY_ACCESS_TOKEN` | Local only, optional | Short-lived disposable test-user session token for authenticated verification; never add to Vercel or Git |

Public values are bundled at build time. Restart local development after edits and redeploy Vercel after changing them. A configured key means the client can initialize; only successful live checks establish connectivity. Session tokens are private credentials even though the publishable key is public.

### Verify the backend

Run `npm run verify:backend`. With no configuration it exits 2 and reports the missing setup. With only public settings it checks the Auth endpoint and exits 2 because authenticated checks remain pending. For full checks, sign in with a disposable test account and locally place that account’s short-lived Supabase access token in the optional verification variable. Obtain it only from your own test browser’s application storage. Delete that value after verification; do not share or commit it.

The script verifies identity, schema version, authorized reads, a cross-account-filtered device read, and Realtime subscription. It never prints tokens or clipboard text. It does not prove full two-device delivery or comprehensive RLS isolation. In a **dedicated test project**, run `supabase/tests/security.sql` as the database administrator through SQL Editor, or `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql` in a shell whose database URL is securely configured. The script creates temporary test accounts, asserts cross-account isolation, authorization, pairing, idempotent receipt, expiry, and history deletion, then rolls back everything. Do not interrupt it mid-transaction; close/rollback the session if it fails.

For local Supabase, install Docker Desktop and the official Supabase CLI, run `supabase start`, then `supabase db reset`. The reset command is **only for the disposable local database** and destroys its local contents. Neither Docker nor a local database is bundled with this project.

## 3. Create and push GitHub

The local repository already uses `main` and retains its existing history. No GitHub remote existed during inspection. The connected account is `rupesh040`; the available connector can read repositories but cannot create one, and the browser requires GitHub login.

1. Sign in at https://github.com/new and create a **private**, empty repository named `clipsync` under the intended owner. Do not initialize README, gitignore, or license because this project already has history. If that name exists, choose a new name and substitute its URL below. No existing repository should be overwritten.
2. From this repository root, inspect `git status` and `git remote -v`. The project changes have been committed locally after verification. If there is no `origin`, run:

```powershell
git remote add origin https://github.com/rupesh040/clipsync.git
git push -u origin main
git ls-remote --heads origin main
```

3. Authenticate through Git Credential Manager’s browser flow if prompted. Do not embed a token in a remote URL. If `origin` already exists, inspect it and use its correct destination rather than replacing it blindly. If the push is rejected or the remote has unexpected commits, stop and reconcile the histories; never force-push.
4. With authenticated GitHub CLI available, the equivalent new-repository command is `gh repo create rupesh040/clipsync --private --source . --remote origin --push`. Only run it when that repository and remote do not exist.
5. Verify the GitHub repository shows the local `main` commit and that its CI workflow passes. GitHub account permissions and Git transport credentials are separate from the readable Codex connector.

## 4. Deploy Vercel

1. Sign in at https://vercel.com/new and import the GitHub repository above. Grant access only to the intended repository. Select your Vercel personal/team account manually. Review any billing or contractual prompts yourself.
2. Use Framework Preset **Next.js**, Root Directory **.**, Node **22.x**, Install Command **npm ci**, Build Command **npm run build**, and the default Next.js Output Directory. Do not set `out`: this release uses Next.js’s normal Vercel output so HTTP security headers are applied. `vercel.json` records the framework and build commands.
3. Add the public application environment variables listed above in Vercel → Project → Settings → Environment Variables, scoped to Production and the trusted Preview environments you intend to use. Leave the optional test access token out of Vercel. No service-role key, database password, SMTP credential, or Supabase admin access token belongs in this frontend deployment.
4. Deploy. Vercel assigns a production URL; **do not assume it will be clipsync.vercel.app**. Set `NEXT_PUBLIC_SITE_URL` to the assigned canonical origin or your configured custom domain, update the exact Supabase Site URL and callback allowlist, and redeploy. Public environment changes only take effect in a new build.
5. Verify `/`, `/dashboard/`, `/history/`, `/devices/`, `/activity/`, `/settings/`, `/help/`, `/login/`, `/signup/`, `/privacy/`, `/auth/callback/`, `/manifest.webmanifest`, `/sw.js`, and the icon URLs. Check `/sw.js` has JavaScript content type and `Cache-Control: no-store`.
6. Check the login flow on that production origin. Request the link there and open it in that **same browser**. A link requested in Chrome and opened in Safari will not have Chrome’s PKCE verifier. Repeat sign-in separately on each device using the same account.
7. Pair two browsers with the workflow below. Confirm receipt in both directions and test revocation. Do not call the deployment operational until these live checks pass.

No custom backend CORS proxy is needed: the browser calls the Supabase HTTPS endpoint using its supported API headers and public client key. Auth redirect allowlisting is configured separately from CORS. If using custom domains, a proxy, or self-hosted Supabase, configure its allowed origins and HTTPS explicitly; do not replace it with permissive CORS rules containing credentials.

## 5. Pairing and production acceptance

- On device A, sign in, open Devices → Connect a device, choose its platform, name it, and generate a five-minute code.
- On device B, sign in to the same account, open the same flow, enter A’s code, and choose Request connection. Return to A and choose Confirm connection. On B, choose Verify connection.
- Keep A’s pairing dialog open to confirm. The Cancel pairing button invalidates its pending code; closing the dialog leaves the code to expire naturally after five minutes. Complete registration within that window. Canceled attempts can count toward the ten-per-hour pairing creation limit.
- Send a test-only, non-sensitive clip from A, verify it appears on B, tap Copy on B, and paste it into an expendable text field. Repeat B → A. Receipt means the browser received it, not that the OS clipboard was overwritten.
- Sign in with another disposable account and verify it cannot see the first account’s devices or clips. Test expired/consumed codes, wrong-account codes, revoked device sends, signed-out requests, paused sending, denied clipboard permission, disconnect/reconnect, and hidden/mobile background behavior.
- Turn history on and choose retention. Turn it off and confirm stored clips are deleted. Test cleanup in the dedicated test environment and confirm the cron job’s production health.

## 6. PWA installation

**Android:** open the deployed HTTPS site in Chrome. Tap Install App; when Chrome has exposed `beforeinstallprompt`, this opens its native install prompt. Otherwise follow the displayed browser menu → Install app/Add to Home screen instructions. Launch from the home-screen icon and confirm a standalone window opens `/dashboard/`, sign in, and run the two-device test. Check the install button hides in standalone mode or after `appinstalled`. A declined prompt must not report a successful install.

**iPhone/iPad:** open the production site in Safari → Share → Add to Home Screen → enable Open as Web App if shown → Add. Launch the icon. Sign in within that browser/app context as needed; browser and installed-app sessions may differ. The app also detects desktop-mode iPads for these instructions.

**Desktop:** use Chrome/Edge’s install control or supported Safari File → Add to Dock. Unsupported browsers may only offer bookmarks. The app shows instructions instead of fabricating native installation success.

**Offline:** first visit online so the service worker installs. Then, on a real test device, disconnect networking and navigate/relaunch. You should see the branded offline page. Only the public offline page, icons, manifest, stylesheet, and immutable Next static resources are cached. Signed-in HTML, clipboard data, Supabase requests, auth codes, and mutation requests are excluded. No offline send queue exists. Reconnect and retry. Increment the service worker cache version when its public offline assets change.

PWA installation does not generate an APK/IPA and does not allow unrestricted background clipboard monitoring. Android/iOS native install and background behavior require real-device acceptance tests; desktop responsive checks do not substitute for them.

## Reference documentation

- https://nextjs.org/docs/app/guides/progressive-web-apps
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/deployment/database-migrations
- https://vercel.com/docs/frameworks/full-stack/nextjs
