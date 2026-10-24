import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { TEST_ID, as, createUser, freshDb, service, user } from './harness';

/** Tests the paste-into-Supabase verification script itself: it must pass on a correct database and FAIL when a protection is removed. */
const script = readFileSync(join(__dirname, '..', '..', 'supabase', 'tests', 'live_rls_checks.sql'), 'utf8');
let db: PGlite;
const run = async () => {
  await db.exec(script);
  return (await db.query<{ check_name: string; passed: boolean; detail: string }>(`select check_name, passed, detail from fluent_rls_results order by n`)).rows;
};
beforeAll(async () => {
  db = await freshDb();
  const a = await createUser(db, 'a@example.com', 'Alice'); await createUser(db, 'b@example.com', 'Bilal');
  const att = (await as(db, user(a), (q) => q(`select start_or_resume_attempt($1) as p`, [TEST_ID])))[0].p.attempt.id;
  await as(db, user(a), (q) => q(`select save_responses($1, $2::jsonb)`, [att, JSON.stringify([{ questionId: 'rd01-q01', answer: 'B', flagged: false, unsure: false, seq: 1 }])]));
  await as(db, service, (q) => q(`select finalize_attempt($1, $2, 'learner_submitted')`, [att, a]));
  await as(db, service, (q) => q(`select store_result($1, '{"score":{"rawScore":1,"maxScore":20,"sectionScores":[],"scoringVersion":"x"}}'::jsonb, 1)`, [att]));
}, 60_000);
afterAll(async () => { await db.close(); });

describe('live_rls_checks.sql', () => {
  it('passes every check on a correctly configured database, and writes nothing', async () => {
    const before = (await db.query<{ n: number }>(`select (select count(*) from results) + (select count(*) from activity_events) + (select count(*) from test_attempts) as n`)).rows[0].n;
    const rows = await run();
    expect(rows.length).toBeGreaterThanOrEqual(25);
    expect(rows.filter((r) => !r.passed), JSON.stringify(rows.filter((r) => !r.passed))).toEqual([]);
    expect((await db.query<{ n: number }>(`select (select count(*) from results) + (select count(*) from activity_events) + (select count(*) from test_attempts) as n`)).rows[0].n).toBe(Number(before));
    expect((await db.query<{ role: string }>(`select role from profiles where role = 'admin'`)).rows).toEqual([]);   // the privilege-escalation probe was rolled back
  });
  it('REPORTS FAILURES when protections are removed (it can fail)', async () => {
    await db.exec(`create policy leak on public.answer_keys for select to authenticated using (true); create policy leak2 on public.responses for select to authenticated using (true);
                   grant execute on function public.finalize_attempt(uuid, uuid, text) to authenticated; create policy leak3 on public.results for select to authenticated using (true);`);
    const failed = (await run()).filter((r) => !r.passed).map((r) => r.check_name);
    expect(failed).toEqual(expect.arrayContaining(['learner cannot read answer_keys', 'B sees none of A\'s responses', 'B sees none of A\'s results', 'learner cannot call finalize_attempt']));
  });
  it('does not pass vacuously: with no saved answers / reports it reports NO DATA failures', async () => {
    const bare = await freshDb(); const x = await createUser(bare, 'x@example.com', 'Xavier'); await createUser(bare, 'y@example.com', 'Yara');
    await as(bare, user(x), (q) => q(`select start_or_resume_attempt($1)`, [TEST_ID]));
    await bare.exec(script);
    const rows = (await bare.query<{ check_name: string; passed: boolean }>(`select check_name, passed from fluent_rls_results`)).rows;
    expect(rows.filter((r) => !r.passed).map((r) => r.check_name).join('|')).toMatch(/NO DATA: attempt with saved answers[\s\S]*NO DATA: submitted attempt/);
    await bare.close();
  });
  it('refuses to run (clear message) when the prerequisites are missing', async () => {
    const empty = await freshDb();
    await expect(empty.exec(script)).rejects.toThrow(/PREREQUISITE/);
    await empty.close();
  });
});
