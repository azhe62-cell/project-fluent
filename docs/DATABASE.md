# Database & Supabase backend

Everything here targets **PostgreSQL via Supabase** and costs nothing: the Supabase **Free** plan is enough for development (limits change — check Supabase's current pricing page), and the automated database tests need **no account at all**.

> **Read this first — what has and hasn't been tested.** The migrations, RLS policies, SQL functions, Edge Function *handlers* and the Supabase *adapter* are exercised by automated tests against **real PostgreSQL 16** (PGlite) — see §2. A small shim stands in for Supabase's `auth` schema. **No test has run against a hosted Supabase project**, and GoTrue (real sign-up / e-mail / sessions), PostgREST over HTTP, JWT verification and the Deno Edge runtime are **untested**. §4 gives you a script and checklist to verify those on your own project. Details: [`STATUS.md`](STATUS.md).

## 1. What's in `supabase/`

| Path | Purpose |
|---|---|
| `migrations/0001_schema.sql` | Tables, constraints, indexes, profile trigger |
| `migrations/0002_rls.sql` | Row Level Security + least-privilege grants |
| `migrations/0003_functions.sql` | Attempt lifecycle functions |
| `migrations/0004_backend_completion.sql` | **Sign-up fix**, rate limiting, RPC reads, Mistake Vault, targeted practice, grading helpers |
| `seed.sql` | Generated original content (no learners, no fake stats) — `npm run seed:generate` |
| `setup_all.sql` | Migrations + seed in ONE file for the SQL editor — `npm run db:bundle` |
| `functions/submit-attempt` · `submit-practice` · `delete-account` | Edge Functions (thin shells over tested handlers) |
| `functions/_shared/server.js` | **Generated** bundle of `src/server` + `src/engine` — `npm run build:edge` |
| `tests/00_supabase_shim.sql` | **TEST-ONLY** stand-in for Supabase roles/`auth` schema. Never run it on Supabase. |
| `tests/live_rls_checks.sql` | Read-only verification script to paste into **your** project's SQL editor |

Migrations are **forward-only**: never edit a migration that has been applied; add a new numbered file. 0004 is tested as an upgrade on top of an existing 0001–0003 database.

## 2. Run the database tests locally (no account, no Docker)

PowerShell (your `npm.ps1` is blocked, so use `npm.cmd`):

```powershell
cd C:\path\to\project-fluent
npm.cmd install
npm.cmd run test:db        # real-PostgreSQL tests only (~15 s)
npm.cmd test               # everything: engine, UI, services, database
npm.cmd run verify         # typecheck + all tests + production build
```

macOS/Linux: the same with `npm`.

**What `test:db` proves** (all run on a real PostgreSQL engine, with roles/grants/RLS enforced):

* Anonymous users can read only the published catalogue (answer-free) — and nothing else; they cannot call attempt functions.
* Learners read only their own profile/attempts/responses/results/vault/practice/activity; cannot write those tables directly; cannot read `answer_keys`/`questions`; cannot self-promote to admin; cannot call service-only functions.
* Cross-user: B cannot read, save into, submit, score, vault-from, or practise against A's data (and `get_attempt` gives no hint it exists).
* Attempts: server-stamped deadline, idempotent start (also enforced by a unique index), stale/out-of-order saves ignored, malformed answers rejected, expiry (lazy and on resume), grace window, locked after submit.
* Scoring: computed **server-side** from stored answers and private keys; forged `score` / `userId` / `answers` in the request are ignored; malformed stored answers score as unanswered; concurrent double-submit ⇒ one result, one activity event.
* Mistake Vault: eligibility decided from the server's stored report; dedupe; privacy; "understood" never masters; mastery needs a streak **and** a fresh related question; forged "fresh" questions refused.
* Rate limiting, account-deletion cascade, the 0001→0004 upgrade path, the 1-character-email sign-up bug.
* The **real UI** driving the **real Supabase adapter** over PostgreSQL through the full journey.
* `live_rls_checks.sql` itself passes on a good DB and fails when a protection is removed.

**What it does NOT prove:** hosted-Supabase configuration, GoTrue/e-mail/sessions, PostgREST/HTTP/CORS, JWT signature checks, the Deno runtime, Supabase's real default privileges, network behaviour, or performance. Do §4.

**Mutation check (done once, by hand):** I deliberately removed protections and confirmed the suite fails each time — learners reading answer keys; reading others' responses; calling `finalize_attempt`; self-promoting to admin; anonymous reading attempts; stale saves overwriting; rate limit disabled; vault accepting ineligible items; saves accepted after the deadline; `store_result` overwriting. (One earlier "mutation" was a no-op and was discarded.)

## 3. Set up a Supabase project (free tier)

**Use a separate project for development and production. Never apply anything to a project holding real data without a backup, and never run `supabase db reset` against a linked database** — it erases it. Nothing in this repo asks you to.

### Path A — no CLI, no Docker (recommended to start)

1. <https://supabase.com> → New project (Free plan). Save the database password.
2. **Project Settings → API**: copy the *Project URL* and the **anon / public** key. (Never copy the `service_role` key into `.env` or the frontend.)
3. **SQL Editor → New query**: open `supabase\setup_all.sql` from this repo, paste, **Run**. It creates everything and seeds the content. It is for a **fresh** project: re-running on a populated one fails harmlessly at the first `CREATE TABLE`; it contains no `DROP`/`TRUNCATE`.
   *(Regenerate it any time with `npm.cmd run db:bundle`.)*
4. **Authentication → URL Configuration**: Site URL `http://localhost:5173`; add Redirect URLs `http://localhost:5173/auth/login` and `http://localhost:5173/auth/reset-password`.
5. **Authentication → Providers → Email**: for development you can turn **Confirm email** off (Supabase's built-in mailer is heavily rate-limited — only a few e-mails per hour). Turn it **on** before launch and configure your own SMTP. Set minimum password length to **10** (matches the form).
6. Configure the app (PowerShell):
   ```powershell
   Copy-Item .env.example .env
   notepad .env      # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
   npm.cmd run dev
   ```
   With both variables set the app uses Supabase; with them empty it falls back to the local demo (banner shown).
7. Deploy the three Edge Functions — see [`DEPLOYMENT.md`](DEPLOYMENT.md). **Without them, submitting an exam and grading practice will fail** (the UI shows an error and keeps your saved answers).

### Path B — Supabase CLI

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref <DEV_PROJECT_REF>
npx.cmd supabase db push --dry-run     # shows what WOULD be applied; changes nothing
npx.cmd supabase db push               # applies pending migrations (additive only)
```
Then load `supabase\seed.sql` via the SQL editor (the CLI does not seed a remote project by default). *I could not run the CLI in the build sandbox; confirm flags with `npx.cmd supabase db push --help` on your version.*

### Make yourself an admin (development only; admin UI isn't built yet)

SQL editor: `update public.profiles set role = 'admin' where id = '<your auth.users id>';`

## 4. Verify your real project (do all of this before trusting it)

### 4a. Automated, read-only RLS script
1. In the app, register **two** learners, start the mini-mock as one, **save an answer**, and **submit** one attempt (so a report exists).
2. SQL editor → paste `supabase\tests\live_rls_checks.sql` → Run.
3. Expect a table of 32 checks all `passed = true` and `ALL … CHECKS PASSED`. **Any `false` = do not launch**; any "NO DATA" row means a prerequisite is missing, not that you're safe.
The script changes nothing (every denied-probe is rolled back even if it unexpectedly succeeds).

### 4b. Manual checklist (the parts no automated test here could reach)
| # | Check | Expected |
|---|---|---|
| 1 | Register with a **1-character** e-mail name (`c@yourdomain`) | account created (this crashed before 0004) |
| 2 | Register with confirmation **on**; click the e-mail link | lands on `/auth/login`; can then sign in |
| 3 | Register the same e-mail again | same "check your e-mail" screen — no "already registered" leak |
| 4 | Sign in with a wrong password / unverified e-mail | clear, distinct messages |
| 5 | Reload the page while signed in | still signed in (session restored) |
| 6 | Forgot password → e-mail link | lands on `/auth/reset-password`, asks for a **new password**, then signs in |
| 7 | Sign out; open `/dashboard` | redirected to sign-in, destination remembered |
| 8 | Start the mini-mock, answer, wait for **Saved**, **reload** | same attempt, answers restored |
| 9 | Submit (watch the Network tab) | `submit-attempt` returns 200; report appears; **no answer keys in any response before submit** |
| 10 | Submit from a second tab | same report; `select count(*) from results where attempt_id = …` is **1** |
| 11 | Let an attempt run past its deadline, then submit | report says **Time expired** |
| 12 | Save mistakes → Vault → Retry → Practice a fresh one | vault updates; graded by `submit-practice` |
| 13 | Settings → Delete account | rows vanish (`select count(*) from public.test_attempts where user_id = …` = 0) |
| 14 | Browser devtools → Sources: search the JS for `service_role` and `Not Given — not False` | **no matches** |

## 5. Design notes

* **RPC-only data access.** The adapter reads/writes through `SECURITY DEFINER` functions that re-check `auth.uid()`; the tables have no learner write policies. (A test fails if the adapter ever calls `.from()`.)
* **Server clock decides deadlines**, status, ownership and rate limits; the client only displays.
* **Scoring** runs in an Edge Function using the same engine the unit tests cover, with the **service-role key held only as an Edge Function secret**. `finalize_attempt`/`store_result` are executable only by `service_role`.
* **`answer_keys` holds explanations too** (deviation from the brief's column list) so nothing answer-revealing sits in a learner-readable table.
* **Rate limits** (`rate_limits`, fixed window): save 600/min, get 240/min, start 30/min, submit 30/min, vault/practice 60/min. Tune in `0004` (new migration to change).
* **`SQL finalize_attempt` and TS `finalizeAttempt` express the same rules twice**; the local adapter uses TS, Supabase uses SQL. Change both together.
* **Changing content:** published versions are immutable. Add a new version (new `test_versions` row, bump `tests.current_version`); never edit a published one.
* **Known limits:** `save_responses` checks answer shape/size, not per-type option validity — the scoring handler re-validates and scores malformed answers as unanswered. No automatic purge of old `rate_limits` rows (tiny; add a scheduled cleanup if it grows).
