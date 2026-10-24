# Status report — Backend milestone

_Every statement below is labelled **Verified** (I ran it and saw the result), **Not verified** (written, never executed against the real thing), or **Not built**._

## 1. Phase A audit (what I found before changing anything)

| Area | Finding |
|---|---|
| Local vs Supabase separation | **Correct.** One dynamic switch (`src/services/index.ts`); local adapter and answer keys are never imported by Supabase code. Supabase-configured bundle: 0 answer-key phrases, 0 `service_role`/`SERVICE_ROLE`, 0 local-adapter markers (the single `localStorage` hit is supabase-js's own session storage). Local banner shown only in local mode (tested). |
| Existing SQL | Applied cleanly on real PostgreSQL, **but** the sign-up trigger had a bug (below). RLS/grants behaved as designed in 42 targeted tests. |
| Supabase adapter | Typechecked but relied on PostgREST table embedding it had never run; vault & practice **stubbed as unavailable**. |
| Edge Function | Scoring logic lived inside the untestable Deno file. |
| Auth | Password reset was **incomplete** (see below). Error handling was generic. |
| Rate limiting | Absent. |
| Tests | Zero database tests existed. |

## 2. Defects found and fixed

| # | Defect | How it was found | Fix |
|---|---|---|---|
| 1 | **Account creation fails** when the e-mail local part is 1 character and no display name is supplied (`c@x.com`): profile check constraint (2–60 chars) aborted `auth.users` insert | New real-PostgreSQL tests | Migration `0004` robust fallback; regression-tested incl. upgrade path |
| 2 | **Password reset didn't finish:** the e-mail link signed the user in but never asked for a new password | Auth-flow audit | New `/auth/reset-password` page + `updatePassword`; redirect URL documented |
| 3 | Mistake Vault & targeted practice **unavailable** in Supabase mode | Audit | Implemented: SQL functions (`0004`), `submit-practice` Edge Function, adapter |
| 4 | Scoring logic **untestable** inside the Deno file | Audit | Moved to `src/server` handlers over a `ServerDb` interface; same code runs under test (on PostgreSQL) and in the Edge Function |
| 5 | Adapter depended on unverified PostgREST `select`/embedding | Audit | **RPC-only**; a test fails if the adapter ever calls `.from()` |
| 6 | No rate limiting | Audit | Per-learner fixed-window limits in SQL + handlers; tested incl. recovery |
| 7 | Sign-up could reveal whether an e-mail is registered | Auth audit | Neutral "check your e-mail" for both Supabase duplicate behaviours (unit-tested) |
| 8 | Overdue open attempts displayed as "In progress" in History | Audit | Shown as "Time expired" |
| 9 | My `live` verification idea would have **passed vacuously** on empty tables | Mutation testing of the script | Script now fails with "NO DATA" and has positive controls |
| 10 | `npm run build` would have failed (unused import in a test) | Running the real `npm run verify` | Fixed |
| 11 | Stray: `finalize_attempt` returned no report for already-scored attempts (extra round-trip) | Design review | Returns stored report |

_Not defects:_ the answer-key and cross-user protections in 0001–0003 held up under test; nothing needed loosening or tightening there beyond the above.

## 3. Verified (executed in this repo)

| Check | Result |
|---|---|
| `npm run verify` = typecheck + all tests + production build | **passes: 220 / 220 tests, 15 files** |
| Real PostgreSQL 16 (PGlite): migrations 0001→0004 + seed apply cleanly | yes |
| Database/RLS/function tests (`rls-core`: 42, `backend`: 28, `live-script`: 4) | all pass |
| Real **UI** → real **Supabase adapter** → real **PostgreSQL**: register-less journey start → answer → autosave → refresh → submit → report → vault → retry → practice → recommendations → history; second learner sees nothing; backend-failure error state | passes (4 tests) |
| Auth adapter logic with a scripted fake client (14 tests) | passes — _verifies our mapping only, not GoTrue_ |
| Paste-into-Supabase `live_rls_checks.sql`: 32 checks, all pass on a correct DB; **fails** on sabotage; reports NO DATA instead of passing vacuously; writes nothing | yes |
| **Mutation check:** 10 deliberate protection removals — each made the suite fail | yes (list in `DATABASE.md` §2). 1 earlier no-op mutation discarded. |
| Production build, local mode and Supabase mode | both succeed; keys absent from Supabase bundle |
| Edge Function entry files: syntax-checked with esbuild; bundle exports the handlers | yes — _syntax only, not run in Deno_ |
| Clean-checkout install + tests (`npm ci`, from the Milestone-1 commit) | passed then; see §7 below |

### What the stand-in covers
`src/db-tests/fakeSupabase.ts` runs every adapter `rpc()` on real PostgreSQL under the same role PostgREST would use (anon/authenticated/service_role) with the JWT claims set, and routes `functions.invoke` to the real handlers. It replaces **only** HTTP, PostgREST request parsing, JWT signature verification and the Deno runtime.

## 4. NOT verified — needs a real Supabase project (cannot be done in this sandbox)

* **GoTrue**: real registration, e-mail delivery/confirmation, session persistence/restore/refresh, password-reset e-mail, sign-in/out, real error payloads.
* **PostgREST over HTTP** (including how it passes JSON/array parameters to the functions).
* **JWT verification** and CORS in the three Edge Functions; the **Deno runtime**; `supabase functions deploy`.
* Supabase's **real default privileges** (the shim imitates them; the explicit `REVOKE`s are what's tested).
* Hosted performance, concurrency under real load, backups, and the Supabase CLI commands in the docs (flags not executed here).
* Any **browser** behaviour (no browser was available): layout, touch/keyboard use, screen readers, real `<dialog>`/IntersectionObserver.
→ Use `docs/DATABASE.md` §4 (script + 14-point checklist). **Do not call the deployment secure until that passes on your project.**

## 5. Not built (unchanged scope boundary)

Listening, Writing, Speaking, AI assessment, admin UI (`/admin*` remain honest placeholders; admin RLS policies exist), profile preferences (target exam / study goal), per-IP/bot protection, scheduled cleanup of `rate_limits`, Playwright end-to-end tests against a hosted project, monitoring. **Per your instruction I have not started Listening/Writing/Speaking.**

## 6. Known caveats

* Local demo mode is insecure by design (answer keys in the page; no passwords) and is bannered.
* `finalize_attempt` exists in SQL (Supabase path) and TS (local path); change both together.
* `save_responses` validates answer shape/size only; the scoring handler re-validates fully and treats malformed answers as unanswered.
* Edge Function secrets/redirect URLs are configuration you must set; a missing function deploy makes submit/practice-grading fail visibly (answers stay saved).
* Free-tier limits (Supabase e-mail rate limit, project pausing after inactivity, function quotas) change over time — check current terms. Nothing here needs a paid service.
* Content is still small: 19 mock questions, 14 bank items; fresh-question supply runs out (the app says so rather than repeating).

## 7. Clean-checkout verification (final)

From a fresh `git clone` of the final commit: `npm ci` → `npm run verify` → **15 files, 220 tests passed, production build succeeded**; regenerating `seed.sql`, `setup_all.sql` and `functions/_shared/server.js` produced **no diff** (the committed generated files are current).


---

# Update — Reading exam interface redesign

Presentation and interaction only; the engine, runner (timer / autosave / submit), services, SQL and Edge Functions are **unchanged**. Details: [`EXAM_UI.md`](EXAM_UI.md).

## Verified (executed)
| Check | Result |
|---|---|
| `npm run verify` (typecheck + all tests + production build) | **251 / 251 tests, 17 files; build succeeds** (previously 220; +31 new) |
| Pre-existing 220 tests, **unmodified** | all still pass (no test was weakened or deleted) |
| New unit/UI tests: `exam-ui.test.tsx` (26) + `split.test.ts` (5) | every question type's control; sentence-completion field inside the sentence with placeholder + limit beneath; live counter / over-limit; choose-two lock; answered/flagged state + palette names + progress; navigation & Previous/Next across the passage boundary; answer persistence across passages/panes; submit dialog (unanswered/flagged/unsure lists, no submit until confirmed, Keep working, Review unanswered, stale-close-event guard, double-click safe); timer (single `role=timer`, counts down, banner, warn/urgent without animation, **real expiry → time-expired result**); divider (keyboard, limits, reset, persisted, pointer drag clamped); phone tabs; no marking data in the DOM |
| Sabotage check of the new tests (6 deliberate breakages: no placeholder, no min width, Submit skipping the dialog, palette not reporting state, choose-two limit removed, timer animation) | each made the suite fail; baseline restored |
| **Real browser** (headless Chromium 131, Linux): `scripts/browser-check.mjs`, 6 viewports (1440×900, 1280×720, 1024×768, 768×1024, 390×844, 360×640) | **93 / 93 checks pass** — page never scrolls, no horizontal overflow, toolbar pinned, timer/Submit visible, content fills ≥ 62 % of the screen, palette one row, field ≥ 95×36 px with ≥ 2 px border, limit directly beneath, answers persist, Prev/Next scroll the target into view, panes scroll independently, divider drag + both 340 px minimums + reset + keyboard, phone tab switching keeps scroll, dialog fits the viewport, jump-to-unanswered works |
| Screenshots inspected by eye (desktop, phone, smallest phone, submit dialog, practice screen) | yes — saved in `docs/screenshots/` |
| Supabase-mode UI journey (real UI → real adapter → real PostgreSQL) still passes with the new exam screen | yes (`ui-supabase.test.tsx`) |

## Defects found by actually looking at / driving the UI (all fixed)
1. **The page itself scrolled** (document 3636 px in an 844 px viewport): screen-reader-only text is `position:absolute` and the panes weren't positioned, so it escaped their `overflow` and stretched the document. Panes are now positioned and the exam root is `fixed inset-0`.
2. **Next/Previous misreported the current question** near the end of a passage (the last questions can't scroll to the top, so the scroll-watcher called the one above "current"). Jumps now pin the current question until the learner really scrolls; panes have end padding.
3. **"Review unanswered" silently failed**: closing a modal `<dialog>` restores focus and scroll to the previous control, undoing the jump; and a *late* `close` event could shut a re-opened dialog. Jumps now run after the dialog closes, from an effect; stale close events are ignored.
4. **Scroll/focus after a jump relied on `requestAnimationFrame`**, which can stall; replaced with layout effects.
5. Empty-field placeholder clipped ("Type answe"); inline fields wrapped awkwardly and the line spacing was far too airy on phones; practice cards had no gap.

## Not verified / limits
* **Not run in Chrome/Edge on Windows** or on a real phone/tablet: the browser check used headless Chromium on Linux; touch gestures, on-screen keyboards, iOS Safari/Firefox, and real-device performance are untested. The `check:browser` PowerShell invocation is documented but unrun by the author.
* **No screen-reader pass** (NVDA/JAWS/VoiceOver) and no automated WCAG audit (axe) was run; semantics (native inputs, labels, `role=timer/progressbar/separator`, aria names) are in place and unit-tested, and token contrast was computed earlier, but "accessible" is unproven.
* Hosted-Supabase items listed earlier in this document are unchanged and still untested.
* Not built: passage text highlighting, notes, text-size beyond three steps.
