# Project Fluent *(working name — check brand & domain availability before launch)*

An **independent, free IELTS-style English practice platform**. It is not affiliated with, endorsed by, or connected to IELTS or any exam provider; practice marks are estimates, not official results.

Core idea — the **Exam-to-Mastery loop**: take a timed mock → read a transparent report → save misses to a private Mistake Vault → practice fresh, targeted questions → measure improvement.

> **Milestone 1 + backend milestone:** a working Reading exam engine, original content, Mistake Vault and targeted practice in **both** local and Supabase modes, with the Supabase SQL/RLS/Edge-handler/adapter layers tested on real PostgreSQL. **Not yet tested against a hosted Supabase project** — read [`docs/STATUS.md`](docs/STATUS.md) for exactly what is and isn't verified.

## Run it locally (no accounts or credentials needed)

Windows PowerShell (use `npm.cmd` because `npm.ps1` is blocked; macOS/Linux: plain `npm`):

```powershell
cd C:\path\to\project-fluent
npm.cmd install
npm.cmd run dev          # http://localhost:5173
```

With no Supabase variables set, the app runs in **local demo mode**: data lives in your browser's `localStorage`, "accounts" are just a name + email (no passwords), and the answer keys are loaded in the page. A banner says so on every screen. This mode is for trying the product — **never for real learners**.

## Commands

| Command (`npm.cmd` on Windows) | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | **Everything**: engine, services, UI, and real-PostgreSQL database tests |
| `npm run test:unit` | All tests except the database ones (fast) |
| `npm run check:browser` | Real-browser exam-screen check (6 viewports; needs `CHROME_PATH`) — see [`docs/EXAM_UI.md`](docs/EXAM_UI.md) |
| `npm run test:db` | Database/RLS/backend tests on real PostgreSQL (PGlite, no install needed) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run verify` | typecheck → all tests → build |
| `npm run seed:generate` | Regenerate `supabase/seed.sql` from the tested content |
| `npm run db:bundle` | Build `supabase/setup_all.sql` (migrations + seed in one file) |
| `npm run build:edge` | Bundle `src/server` + `src/engine` for the Edge Functions |

The Reading exam screen is a full-viewport, two-panel workspace (resizable divider, numbered palette, obvious answer fields) with its own tablet/phone layout: see **[`docs/EXAM_UI.md`](docs/EXAM_UI.md)**.

## Using Supabase (real accounts, server-side scoring)

Free tier is enough. Follow **[`docs/DATABASE.md`](docs/DATABASE.md)** (setup, tests, verification) then **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** (Edge Functions, hosting). In short: create a project → paste `supabase/setup_all.sql` into the SQL editor → set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `.env` → deploy three Edge Functions → run `supabase/tests/live_rls_checks.sql`.

In Supabase mode the Mistake Vault and targeted practice work the same as locally. A production build in this mode contains **no answer keys and no service-role reference** (checked by searching the bundle).

## Architecture in one page

```
src/engine/      Pure TypeScript, no I/O. Scoring, normalisation, validation, attempt state machine,
                 server-authoritative timer maths, autosave queue, vault rules, recommendations, streaks.
src/content/     ORIGINAL passages & questions.  *.public.ts = client-safe.  *.keys.ts = SERVER-ONLY answers.
src/services/    Interfaces (types.ts) + two adapters:  local/ (dev only)  and  supabase/ (RPC + Edge Functions).
src/server/      Trusted request handlers (submit attempt / grade practice) + DB interface; bundled into the Edge Functions.
src/db-tests/    Real-PostgreSQL tests (RLS, functions, adapter, UI-over-Supabase-adapter).
src/components/, src/pages/   UI. Talks only to the service interfaces.
supabase/        migrations (schema, RLS, functions), Edge Functions, generated seed.
```

**Security boundary.** Answer keys and explanations never travel with questions. The browser receives an answer-free snapshot; answers, explanations and marks arrive only after the attempt is finalised. In the Supabase path, learners have no direct write access to attempts/responses/results — everything goes through `SECURITY DEFINER` functions or the `submit-attempt` Edge Function, which re-check ownership, status and deadline.

**Same code, tested once.** The scoring/validation code that Vitest exercises is the code the Edge Function runs (bundled by `build:edge`).

## Design system

Tokens are CSS variables in `src/styles/index.css` (ink + paper + one violet signal + one gold accent), mapped in `tailwind.config.js`. Display type is Fraunces, UI type Hanken Grotesk, numerals/timer JetBrains Mono (self-hosted via `@fontsource`). The exam screen is a separate, chrome-free layout. Contrast ratios for the token pairs were computed against WCAG AA.

## Honest limitations

See [`docs/STATUS.md`](docs/STATUS.md). In short: nothing has run against a hosted Supabase project (GoTrue, PostgREST/HTTP, JWT, Deno untested); no browser was available to visually inspect the UI; Listening, Writing, Speaking, AI feedback and admin tools are not built.
