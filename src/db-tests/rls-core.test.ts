import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { TEST_ID, BANK_ID, ageAttempt, anon, as, createUser, draft, freshDb, owner, service, user } from './harness';

let db: PGlite; let A: string; let B: string; let attemptA: string;
const start = (id: string) => as(db, user(id), async (q) => (await q(`select start_or_resume_attempt($1) as p`, [TEST_ID]))[0].p);

beforeAll(async () => {
  db = await freshDb();
  A = await createUser(db, 'a@example.com', 'Alice'); B = await createUser(db, 'b@example.com', 'Bilal');
  attemptA = (await start(A)).attempt.id;
  await as(db, user(A), (q) => q(`select save_responses($1, $2::jsonb)`, [attemptA, JSON.stringify([draft('rd01-q01', 'B', 1)])]));
}, 60_000);
afterAll(async () => { await db.close(); });

const TABLES = ['profiles', 'test_attempts', 'responses', 'results', 'mistake_items', 'practice_sessions', 'activity_events', 'answer_keys', 'questions', 'test_sections', 'passages'];

describe('anonymous visitors', () => {
  it('see only published, listed catalogue content', async () => {
    const tests = await as(db, anon, (q) => q(`select id from tests`));
    expect(tests.map((t) => t.id)).toEqual([TEST_ID]);              // the hidden practice bank is NOT listed
    const vs = await as(db, anon, (q) => q(`select test_id from test_versions`));
    expect(vs.map((v) => v.test_id)).toEqual([TEST_ID]);
  });
  it('the public snapshot contains no answers', async () => {
    const [{ c }] = await as(db, anon, (q) => q(`select public_content::text as c from test_versions`));
    for (const banned of ['"rule"', '"accepted"', '"explanation"', '"display"']) expect(c).not.toContain(banned);
  });
  for (const t of TABLES) it(`cannot read ${t}`, async () => { await expect(as(db, anon, (q) => q(`select * from ${t}`))).rejects.toThrow(/permission denied/); });
  it('cannot call attempt functions', async () => {
    await expect(as(db, anon, (q) => q(`select start_or_resume_attempt($1)`, [TEST_ID]))).rejects.toThrow(/permission denied/);
    await expect(as(db, anon, (q) => q(`select get_attempt($1)`, [attemptA]))).rejects.toThrow(/permission denied/);
    await expect(as(db, anon, (q) => q(`select save_responses($1, '[]')`, [attemptA]))).rejects.toThrow(/permission denied/);
  });
});

describe('authenticated learners — own data only', () => {
  it('see only their own profile; cannot self-promote to admin', async () => {
    expect((await as(db, user(A), (q) => q(`select display_name from profiles`))).map((r) => r.display_name)).toEqual(['Alice']);
    await expect(as(db, user(A), (q) => q(`update profiles set role = 'admin' where id = $1`, [A]))).rejects.toThrow(/permission denied/);
    expect((await as(db, user(A), (q) => q(`select is_admin() as a`)))[0].a).toBe(false);
  });
  it('can rename themselves but not someone else', async () => {
    await as(db, user(A), (q) => q(`update profiles set display_name = 'Alice K' where id = $1`, [A]));
    const touched = await as(db, user(A), (q) => q(`update profiles set display_name = 'hacked' where id = $1 returning id`, [B]));
    expect(touched).toHaveLength(0);
    expect((await db.query<{ display_name: string }>(`select display_name from profiles where id = $1`, [B])).rows[0].display_name).toBe('Bilal');
  });
  it('profile creation trigger used the sign-up display name', async () => {
    expect((await db.query<{ display_name: string }>(`select display_name from profiles where id = $1`, [A])).rows[0].display_name).toMatch(/^Alice/);
  });
  it('cannot read answer keys, questions, sections or passages (zero rows or denied)', async () => {
    for (const t of ['answer_keys', 'questions', 'test_sections', 'passages']) {
      const rows = await as(db, user(A), (q) => q(`select * from ${t}`)).catch((e) => { expect(String(e.message)).toMatch(/permission denied/); return []; });
      expect(rows, t).toHaveLength(0);
    }
  });
  it('cannot write answer keys or questions', async () => {
    await expect(as(db, user(A), (q) => q(`insert into answer_keys (question_id, version, marks, rule, display, explanation) values ('rd01-q01', 9, 1, '{}', 'x', 'x')`))).rejects.toThrow(/row-level security|permission denied/);
    await expect(as(db, user(A), (q) => q(`update answer_keys set display = 'hacked'`))).resolves.toEqual([]);
  });
  it('cannot write attempts / responses / results / vault / practice / activity directly', async () => {
    const attempts = [
      `insert into test_attempts (user_id, test_id, test_version_id, status) values ('${A}', '${TEST_ID}', '${TEST_ID}@v1', 'scored')`,
      `update test_attempts set status = 'scored', deadline_at = now() + interval '1 year'`,
      `delete from test_attempts`,
      `insert into responses (attempt_id, question_id, answer) values ('${attemptA}', 'rd01-q01', '"B"')`,
      `update responses set answer = '"C"'`, `delete from responses`,
      `insert into results (attempt_id, raw_score, max_score, section_scores, scoring_version, result_view) values ('${attemptA}', 20, 20, '[]', 'x', '{}')`,
      `insert into mistake_items (user_id, question_id, question_version, reason) values ('${A}', 'x', 1, 'incorrect')`,
      `insert into practice_sessions (user_id, mode, question_ids) values ('${A}', 'recommended', ARRAY['x'])`,
      `insert into activity_events (user_id, event_type, questions) values ('${A}', 'attempt_completed', 999)`,
    ];
    for (const s of attempts) await expect(as(db, user(A), (q) => q(s)), s).rejects.toThrow(/permission denied|row-level security/);
  });
  it('cannot call service-role-only functions', async () => {
    await expect(as(db, user(A), (q) => q(`select finalize_attempt($1, $2, 'learner_submitted')`, [attemptA, A]))).rejects.toThrow(/permission denied/);
    await expect(as(db, user(A), (q) => q(`select store_result($1, '{}'::jsonb, 0)`, [attemptA]))).rejects.toThrow(/permission denied/);
    await expect(as(db, user(A), (q) => q(`select attempt_payload($1)`, [attemptA]))).rejects.toThrow(/permission denied/);
  });
  it('an admin (promoted out-of-band) can read answer keys; learners still cannot', async () => {
    const adm = await createUser(db, 'admin@example.com', 'Admin');
    await db.query(`update profiles set role = 'admin' where id = $1`, [adm]);
    expect((await as(db, user(adm), (q) => q(`select count(*)::int as n from answer_keys`)))[0].n).toBeGreaterThan(0);
    expect((await as(db, user(A), (q) => q(`select count(*)::int as n from answer_keys`)))[0].n).toBe(0);
  });
});

describe('cross-user access is blocked', () => {
  it('B cannot see A’s attempt, responses or results; get_attempt gives no hint it exists', async () => {
    expect(await as(db, user(B), (q) => q(`select * from test_attempts`))).toHaveLength(0);
    expect(await as(db, user(B), (q) => q(`select * from responses`))).toHaveLength(0);
    expect(await as(db, user(B), (q) => q(`select * from results`))).toHaveLength(0);
    expect((await as(db, user(B), (q) => q(`select get_attempt($1) as p`, [attemptA])))[0].p).toBeNull();
  });
  it('B cannot save into, or start over, A’s attempt', async () => {
    await expect(as(db, user(B), (q) => q(`select save_responses($1, $2::jsonb)`, [attemptA, JSON.stringify([draft('rd01-q01', 'C', 99)])]))).rejects.toThrow(/not_found/);
    const b1 = await start(B); expect(b1.attempt.id).not.toBe(attemptA);
    expect((await db.query<{ answer: string }>(`select answer from responses where attempt_id = $1 and question_id = 'rd01-q01'`, [attemptA])).rows[0].answer).toBe('B');
  });
  it('service-role finalize refuses a mismatched user id', async () => {
    await expect(as(db, service, (q) => q(`select finalize_attempt($1, $2, 'learner_submitted')`, [attemptA, B]))).rejects.toThrow(/not_found/);
  });
});

describe('start_or_resume_attempt', () => {
  it('is idempotent: repeated calls return the same open attempt', async () => {
    const a = await start(A); const b = await start(A);
    expect(a.attempt.id).toBe(attemptA); expect(b.attempt.id).toBe(attemptA);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from test_attempts where user_id = $1 and status = 'in_progress'`, [A])).rows[0].n).toBe(1);
  });
  it('the unique index makes a duplicate open attempt impossible even for the owner', async () => {
    await expect(db.query(`insert into test_attempts (user_id, test_id, test_version_id, status) values ($1, $2, $3, 'in_progress')`, [A, TEST_ID, `${TEST_ID}@v1`])).rejects.toThrow(/unique|duplicate/);
  });
  it('server stamps a 20-minute deadline and returns an answer-free snapshot + resumed answers', async () => {
    const p = await start(A);
    expect((Date.parse(p.attempt.deadlineAt) - Date.parse(p.attempt.startedAt)) / 1000).toBe(1200);
    expect(p.responses['rd01-q01'].answer).toBe('B');
    expect(JSON.stringify(p.content)).not.toMatch(/"explanation"|"accepted"|"rule"/);
  });
  it('refuses unpublished, unlisted (bank) and unknown tests', async () => {
    await expect(as(db, user(A), (q) => q(`select start_or_resume_attempt($1)`, [BANK_ID]))).rejects.toThrow(/test_not_available/);
    await expect(as(db, user(A), (q) => q(`select start_or_resume_attempt('nope')`))).rejects.toThrow(/test_not_available/);
    await db.query(`update tests set publication_status = 'draft' where id = $1`, [TEST_ID]);
    await expect(start(B)).rejects.toThrow(/test_not_available/);
    await db.query(`update tests set publication_status = 'published' where id = $1`, [TEST_ID]);
  });
});

describe('save_responses', () => {
  const save = (id: string, att: string, items: unknown[]) => as(db, user(id), async (q) => (await q(`select save_responses($1, $2::jsonb) as r`, [att, JSON.stringify(items)]))[0].r);
  it('applies newer drafts and ignores stale / out-of-order ones', async () => {
    const r1 = await save(A, attemptA, [draft('rd01-q02', 'C', 10)]);
    expect(r1).toMatchObject({ applied: 1, stale: 0 });
    const r2 = await save(A, attemptA, [draft('rd01-q02', 'A', 4)]);
    expect(r2).toMatchObject({ applied: 0, stale: 1 });
    const r3 = await save(A, attemptA, [draft('rd01-q02', 'A', 10)]);       // equal seq is also ignored
    expect(r3).toMatchObject({ applied: 0, stale: 1 });
    expect((await db.query<{ answer: string }>(`select answer from responses where attempt_id = $1 and question_id = 'rd01-q02'`, [attemptA])).rows[0].answer).toBe('C');
  });
  it('rejects unknown questions and malformed answers without failing the batch', async () => {
    const r = await save(A, attemptA, [draft('nope', 'A', 1), draft('rd01-q03', { x: 1 }, 1), draft('rd01-q03', 'x'.repeat(201), 2), draft('rd01-q04', 'FALSE', 1)]);
    expect(r.applied).toBe(1);
    expect(r.rejected.map((x: any) => x.questionId)).toEqual(['nope', 'rd01-q03', 'rd01-q03']);
  });
  it('stores flagged / unsure flags', async () => {
    await save(A, attemptA, [draft('rd01-q05', 'TRUE', 1, { flagged: true, unsure: true })]);
    const p = await start(A);
    expect(p.responses['rd01-q05']).toMatchObject({ flagged: true, unsure: true, answer: 'TRUE' });
  });
  it('refuses oversized batches', async () => {
    await expect(save(A, attemptA, Array.from({ length: 61 }, (_, i) => draft('rd01-q01', 'A', i + 100)))).rejects.toThrow(/invalid_payload/);
  });
});

describe('deadline & expiry (time simulated by ageing the attempt)', () => {
  it('within the 5 s grace saves are accepted; after it they are refused with deadline_passed', async () => {
    const id = await createUser(db, 'c@example.com'); const att = (await start(id)).attempt.id;
    await ageAttempt(db, att, 1200 + 3);   // 3 s past the deadline: still inside grace
    const ok = await as(db, user(id), async (q) => (await q(`select save_responses($1, $2::jsonb) as r`, [att, JSON.stringify([draft('rd01-q01', 'B', 1)])]))[0].r);
    expect(ok.applied).toBe(1);
    await ageAttempt(db, att, 10);          // now 13 s past
    const late = await as(db, user(id), async (q) => (await q(`select save_responses($1, $2::jsonb) as r`, [att, JSON.stringify([draft('rd01-q01', 'C', 2)])]))[0].r);
    expect(late).toMatchObject({ fatal: 'deadline_passed', applied: 0 });
    expect((await db.query<{ answer: string }>(`select answer from responses where attempt_id = $1`, [att])).rows[0].answer).toBe('B');
  });
  it('get_attempt lazily marks an overdue attempt EXPIRED (never left open)', async () => {
    const id = await createUser(db, 'd@example.com'); const att = (await start(id)).attempt.id;
    await ageAttempt(db, att, 1200 + 60);
    const p = await as(db, user(id), async (q) => (await q(`select get_attempt($1) as p`, [att]))[0].p);
    expect(p.attempt).toMatchObject({ status: 'expired', submissionKind: 'time_expired' });
    expect(Date.parse(p.attempt.submittedAt)).toBe(Date.parse(p.attempt.deadlineAt));
  });
  it('starting again after abandoning expires the old attempt and opens a fresh one', async () => {
    const id = await createUser(db, 'e@example.com'); const first = (await start(id)).attempt.id;
    await ageAttempt(db, first, 3 * 3600);
    const second = (await start(id)).attempt;
    expect(second.id).not.toBe(first); expect(second.status).toBe('in_progress');
    expect((await db.query<{ status: string }>(`select status from test_attempts where id = $1`, [first])).rows[0].status).toBe('expired');
  });
});

describe('finalize_attempt / store_result (service role)', () => {
  let id: string; let att: string;
  beforeAll(async () => { id = await createUser(db, 'f@example.com'); att = (await start(id)).attempt.id; });
  it('finalises once; repeated calls are no-ops', async () => {
    const a = await as(db, service, async (q) => (await q(`select finalize_attempt($1, $2, 'learner_submitted') as a`, [att, id]))[0].a);
    expect(a).toMatchObject({ status: 'submitted', submission_kind: 'learner_submitted' });
    const b = await as(db, service, async (q) => (await q(`select finalize_attempt($1, $2, 'time_expired') as a`, [att, id]))[0].a);
    expect(b.status).toBe('submitted'); expect(b.submission_kind).toBe('learner_submitted');   // unchanged
  });
  it('after finalisation the learner can no longer save (locked)', async () => {
    const r = await as(db, user(id), async (q) => (await q(`select save_responses($1, $2::jsonb) as r`, [att, JSON.stringify([draft('rd01-q01', 'B', 1)])]))[0].r);
    expect(r.fatal).toBe('not_in_progress');
  });
  it('rejects an invalid submission kind', async () => {
    await expect(as(db, service, (q) => q(`select finalize_attempt($1, $2, 'cheat')`, [att, id]))).rejects.toThrow(/invalid_kind/);
  });
  it('store_result is atomic and idempotent: one result, one activity event, attempt scored', async () => {
    const view = { score: { rawScore: 3, maxScore: 20, sectionScores: [], scoringVersion: 'reading-raw-v1' } };
    const r1 = await as(db, service, async (q) => (await q(`select store_result($1, $2::jsonb, 4) as r`, [att, JSON.stringify(view)]))[0].r);
    const r2 = await as(db, service, async (q) => (await q(`select store_result($1, $2::jsonb, 4) as r`, [att, JSON.stringify({ score: { rawScore: 20, maxScore: 20, sectionScores: [], scoringVersion: 'x' } })]))[0].r);
    expect(r2).toEqual(r1);                                     // second call cannot overwrite
    expect((await db.query<{ n: number }>(`select count(*)::int as n from results where attempt_id = $1`, [att])).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from activity_events where user_id = $1`, [id])).rows[0].n).toBe(1);
    expect((await db.query<{ status: string }>(`select status from test_attempts where id = $1`, [att])).rows[0].status).toBe('scored');
  });
  it('store_result refuses an attempt that is still in progress', async () => {
    const id2 = await createUser(db, 'g@example.com'); const att2 = (await start(id2)).attempt.id;
    await expect(as(db, service, (q) => q(`select store_result($1, '{"score":{"rawScore":1,"maxScore":20,"sectionScores":[],"scoringVersion":"x"}}'::jsonb, 1)`, [att2]))).rejects.toThrow(/not_final/);
  });
});

describe('account deletion', () => {
  it('deleting the auth user cascades to every learner table', async () => {
    const id = await createUser(db, 'zed@example.com'); const att = (await start(id)).attempt.id;
    await as(db, service, (q) => q(`select finalize_attempt($1, $2, 'learner_submitted')`, [att, id]));
    await as(db, service, (q) => q(`select store_result($1, '{"score":{"rawScore":1,"maxScore":20,"sectionScores":[],"scoringVersion":"x"}}'::jsonb, 1)`, [att]));
    await db.query(`delete from auth.users where id = $1`, [id]);
    for (const t of ['profiles', 'test_attempts', 'activity_events']) expect((await db.query<{ n: number }>(`select count(*)::int as n from ${t} where ${t === 'profiles' ? 'id' : 'user_id'} = $1`, [id])).rows[0].n, t).toBe(0);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from results where attempt_id = $1`, [att])).rows[0].n).toBe(0);
  });
});
void owner;
