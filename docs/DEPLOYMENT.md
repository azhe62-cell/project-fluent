# Deployment

> **Status:** the frontend build is verified. The Edge Function *handlers* are tested against real PostgreSQL; the Edge Function *shells* (JWT check, CORS, Deno) and the hosted deployment steps below have **not been executed** by the author — run `docs/DATABASE.md` §4 on a development project first.

All services named here have free tiers (Supabase Free; Vercel / Netlify / Cloudflare Pages free plans). No paid API is required or used. Free-tier limits change — check each provider's current terms.

## Environments

Use **separate** Supabase projects for development and production. Never point a dev build at a production database.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | frontend build | Public. Project URL. |
| `VITE_SUPABASE_ANON_KEY` | frontend build | Public by design; protection comes from RLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function secrets **only** | Injected automatically in hosted functions. **Never** put it in a `VITE_*` variable. |
| `ALLOWED_ORIGIN` | Edge Function secret | Your site origin, e.g. `https://app.example.com` (CORS allow-list). |

Leaving both `VITE_*` variables empty selects **local demo mode** — do not deploy that publicly.

## Steps

1. **Database** — follow `docs/DATABASE.md` on the production project (migrations, then seed).
2. **Auth settings** (Dashboard → Authentication):
   * Site URL = your production origin; add `https://<origin>/auth/login` **and** `https://<origin>/auth/reset-password` to **Redirect URLs** (verification and reset e-mails return there).
   * Enable email confirmation; minimum password length 10 (matches the sign-up form).
   * Configure a real SMTP provider for production email.
3. **Edge Functions** (three: `submit-attempt`, `submit-practice`, `delete-account`). Windows PowerShell:
   ```powershell
   npm.cmd run build:edge                                    # regenerates supabase\functions\_shared\server.js
   npx.cmd supabase login
   npx.cmd supabase link --project-ref <PROJECT_REF>
   npx.cmd supabase secrets set ALLOWED_ORIGIN=https://app.example.com    # dev: http://localhost:5173
   npx.cmd supabase functions deploy submit-attempt
   npx.cmd supabase functions deploy submit-practice
   npx.cmd supabase functions deploy delete-account
   ```
   * `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically in hosted functions — **do not** set the service-role key yourself or put it in `.env`.
   * Deploying may require Docker Desktop for bundling; if you don't have it, try adding `--use-api` (check `npx.cmd supabase functions deploy --help` for your CLI version — I could not run the CLI here).
   * The Dashboard's function editor takes a single file, so these multi-file functions need the CLI.
   * Re-run `build:edge` and redeploy whenever anything in `src\engine` or `src\server` changes.
4. **Frontend** — any static host (Vercel, Netlify, Cloudflare Pages). Build command `npm run build`, output `dist/`, and a **SPA fallback** to `/index.html` so deep links like `/results/…` work. Set the two `VITE_*` variables in the host's build settings.
5. **Security headers** at the host: `Content-Security-Policy` (allow your Supabase origin for `connect-src`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

## Verify the deployed site (don't skip)

1. `curl -I https://<site>/` → 200; open `/results/anything` directly → app loads (SPA fallback works).
2. **Bundle check** — before uploading, with the production env vars set: `npm run build && ! grep -rq "Not Given — not False" dist && echo "no answer data in bundle"`. After deploying, spot-check one served script: `curl -s https://<site>/assets/<main-file>.js | grep -c "Not Given — not False"` → `0`.
3. Register a new account → confirm the verification email arrives and its link returns to `/auth/login`.
4. Start the mini-mock, answer some questions, watch **Saved**, **reload** → answers recovered.
5. Submit → report appears; submit again from a second tab → no second result (`select count(*) from results where attempt_id = …` = 1).
6. Run the ten RLS checks in `docs/DATABASE.md`.
7. Let an attempt run past its deadline, then submit → report shows **Time expired**.
8. Delete the account in Settings → rows disappear.

## Not covered yet

Per-IP / bot protection (the built-in limits are per-learner; add Cloudflare or similar in front for abuse), error monitoring, a backups policy, scheduled cleanup of `rate_limits`, and a privacy review by the operator.
