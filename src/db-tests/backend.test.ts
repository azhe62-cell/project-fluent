import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { SupabaseAssessments } from '@/services/supabase';
import { ServiceError } from '@/services/types';
import { readingMiniMock01Keys } from '@/content/reading-mini-mock-01.keys';
import { practiceBankKeys } from '@/content/practice-bank.keys';
import type { ResponseDraft } from '@/engine';
import { TEST_ID, ageAttempt, anon, as, createUser, freshDb, owner, user } from './harness';
import { pgClient } from './fakeSupabase';

let db: PGlite; let seq = 0;
const svc = (id: string) => new SupabaseAssessments(pgClient(db, user(id)));
const d = (questionId: string, answer: ResponseDraft['answer'], over: Partial<ResponseDraft> = {}): ResponseDraft => ({ questionId, answer, flagged: false, unsure: false, seq: ++seq, ...over });
const right = (id: string) => { const k = readingMiniMock01Keys.find((x) => x.questionId === id)!; return k.rule.kind === 'text' ? k.rule.accepted[0] : k.rule.correct; };
const count = async (sql: string, p: unknown[] = []) => (await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, p)).rows[0].n;

beforeAll(async () => { db = await freshDb(); }, 60_000);
afterAll(async () => { await db.close(); });

describe('catalogue (through the real adapter + real SQL)', () => {
  it('lists only published, listed tests; content is answer-free; usable by anonymous visitors', async () => {
    const guest = new SupabaseAssessments(pgClient(db, anon));
    const tests = await guest.listTests();
    expect(tests).toHaveLength(1);
    expect(tests[0]).toMatchObject({ slug: 'reading-mini-mock-01', questionCount: 19, totalMarks: 20, durationSeconds: 1200 });
    const t = await guest.getTest('reading-mini-mock-01');
    expect(JSON.stringify(t)).not.toMatch(/"accepted"|"explanation"|"rule"|"correct"/);
    expect(await guest.getTest('practice-bank-reading')).toBeNull();
  });
  it('anonymous visitors cannot start attempts or read learner data', async () => {
    const guest = new SupabaseAssessments(pgClient(db, anon));
    await expect(guest.startOrResumeAttempt(TEST_ID)).rejects.toBeInstanceOf(ServiceError);
    await expect(guest.listResults()).rejects.toBeInstanceOf(ServiceError);
    await expect(guest.listVault()).rejects.toBeInstanceOf(ServiceError);
  });
});

describe('exam lifecycle (adapter → RPC → Edge handler → SQL)', () => {
  let A: string; let attempt: string;
  beforeAll(async () => { A = await createUser(db, 'a@example.com', 'Alice'); });

  it('start is server-timed and idempotent; save + resume restores answers; stale saves are ignored', async () => {
    const s = svc(A);
    const first = await s.startOrResumeAttempt(TEST_ID); attempt = first.attempt.id;
    expect((await s.startOrResumeAttempt(TEST_ID)).attempt.id).toBe(attempt);
    expect((Date.parse(first.attempt.deadlineAt!) - Date.parse(first.attempt.startedAt!)) / 1000).toBe(1200);
    const r = await s.saveResponses(attempt, [d('rd01-q01', 'B'), d('rd01-q03', 'TRUE'), d('rd01-q04', 'TRUE', { unsure: true }), d('rd01-q06', 'common'), d('rd01-q09', ['A', 'B'])]);
    expect(r).toMatchObject({ applied: 5, stale: 0 });
    const stale = await s.saveResponses(attempt, [{ ...d('rd01-q01', 'D'), seq: 1 }]);
    expect(stale).toMatchObject({ applied: 0, stale: 1 });
    const resumed = await s.getAttempt(attempt);
    expect(resumed!.responses['rd01-q01'].answer).toBe('B');
    expect(resumed!.responses['rd01-q04'].unsure).toBe(true);
  });

  it('server-side scoring: a concurrent double submit yields ONE stored result with the right marks', async () => {
    const s = svc(A);
    const [r1, r2] = await Promise.all([s.submitAttempt(attempt, 'learner_submitted'), s.submitAttempt(attempt, 'learner_submitted')]);
    expect(r2).toEqual(r1);
    // q01 ✓ q03 ✓ q04 ✗ q06 ✓ q09 half → 3 + 1 = 4
    expect(r1.score).toMatchObject({ rawScore: 4, maxScore: 20, counts: { correct: 3, incorrect: 1, partial: 1, unanswered: 14 } });
    expect(r1.submissionKind).toBe('learner_submitted');
    expect(await count('results where attempt_id = $1', [attempt])).toBe(1);
    expect(await count(`activity_events where user_id = $1 and event_type = 'attempt_completed'`, [A])).toBe(1);
    expect(await s.getResult(attempt)).toEqual(r1);
    expect((await s.listResults()).map((x) => x.attemptId)).toEqual([attempt]);
    expect(r1.review.find((x) => x.questionId === 'rd01-q05')).toMatchObject({ correctDisplay: 'Not Given', outcome: 'unanswered' });
  });

  it('a later submit changes nothing, and answers can no longer be saved', async () => {
    const s = svc(A);
    const again = await s.submitAttempt(attempt, 'time_expired');         // different "kind" must not rewrite history
    expect(again.submissionKind).toBe('learner_submitted');
    expect((await s.saveResponses(attempt, [d('rd01-q02', 'C')])).fatal).toBe('not_in_progress');
    expect(await count('results where attempt_id = $1', [attempt])).toBe(1);
  });

  it('the client cannot influence the score: forged score / user id / answers in the request are ignored', async () => {
    const B = await createUser(db, 'forger@example.com'); const c = pgClient(db, user(B));
    const s = new SupabaseAssessments(c); const att = (await s.startOrResumeAttempt(TEST_ID)).attempt.id;
    const out = await c.functions.invoke('submit-attempt', { body: { attemptId: att, kind: 'learner_submitted', score: 20, rawScore: 20, userId: A, answers: { 'rd01-q01': 'B' }, result: { score: { rawScore: 20 } } } });
    expect(out.error).toBeNull();
    expect(out.data.score.rawScore).toBe(0);
    expect(out.data.review.every((r: any) => r.outcome === 'unanswered')).toBe(true);
    expect(await count('results where attempt_id = $1', [att])).toBe(1);
  });

  it('malformed stored answers (bypassing the UI) are scored as unanswered, never as correct', async () => {
    const C = await createUser(db, 'weird@example.com'); const s = svc(C); const att = (await s.startOrResumeAttempt(TEST_ID)).attempt.id;
    await db.query(`insert into responses (attempt_id, question_id, answer, seq) values ($1, 'rd01-q01', '["B","B","B"]', 1), ($1, 'rd01-q03', '"TRUE"', 1)`, [att]);
    const r = await s.submitAttempt(att, 'learner_submitted');
    expect(r.review.find((x) => x.questionId === 'rd01-q01')!.outcome).toBe('unanswered');
    expect(r.review.find((x) => x.questionId === 'rd01-q03')!.outcome).toBe('correct');
  });
});

describe('cross-user isolation through the adapter', () => {
  it('another learner gets nothing, can change nothing, and learns nothing', async () => {
    const A = await createUser(db, 'owner@example.com'); const B = await createUser(db, 'intruder@example.com');
    const sa = svc(A); const sb = svc(B);
    const att = (await sa.startOrResumeAttempt(TEST_ID)).attempt.id;
    await sa.saveResponses(att, [d('rd01-q01', 'B')]);
    expect(await sb.getAttempt(att)).toBeNull();
    expect((await sb.saveResponses(att, [d('rd01-q01', 'C', { seq: 999 })])).fatal).toBe('forbidden');
    await expect(sb.submitAttempt(att, 'learner_submitted')).rejects.toMatchObject({ code: 'not_found' });
    expect(await sb.getResult(att)).toBeNull();
    expect(await sb.listAttempts()).toEqual([]);
    expect((await db.query<{ answer: string }>(`select answer from responses where attempt_id = $1`, [att])).rows[0].answer).toBe('B');
    expect((await sa.getAttempt(att))!.attempt.status).toBe('in_progress');      // B's submit did not finalise it
  });
});

describe('expired attempts', () => {
  it('after the deadline saves are refused; submit records EXPIRED and scores only pre-deadline answers', async () => {
    const U = await createUser(db, 'slow@example.com'); const s = svc(U);
    const att = (await s.startOrResumeAttempt(TEST_ID)).attempt.id;
    await s.saveResponses(att, [d('rd01-q01', 'B')]);
    await ageAttempt(db, att, 1200 + 30);
    expect((await s.saveResponses(att, [d('rd01-q02', 'C')])).fatal).toBe('deadline_passed');
    const r = await s.submitAttempt(att, 'learner_submitted');
    expect(r.submissionKind).toBe('time_expired');
    expect(r.timeUsedSeconds).toBe(1200);
    expect(r.score.rawScore).toBe(1);
    expect(r.review.find((x) => x.questionId === 'rd01-q02')!.outcome).toBe('unanswered');
    expect(await count(`test_attempts where id = $1 and status = 'scored' and submission_kind = 'time_expired'`, [att])).toBe(1);
  });
  it('an abandoned attempt is finalised and scored as expired when the learner next looks at it', async () => {
    const U = await createUser(db, 'gone@example.com'); const s = svc(U);
    const att = (await s.startOrResumeAttempt(TEST_ID)).attempt.id;
    await s.saveResponses(att, [d('rd01-q01', 'B'), d('rd01-q06', 'common')]);
    await ageAttempt(db, att, 4 * 3600);
    const r = await s.getResult(att);
    expect(r).toMatchObject({ submissionKind: 'time_expired' });
    expect(r!.score.rawScore).toBe(2);
  });
});

describe('Mistake Vault in Supabase mode', () => {
  let U: string; let att: string; let eligible: number;
  beforeAll(async () => {
    U = await createUser(db, 'vault@example.com'); const s = svc(U);
    att = (await s.startOrResumeAttempt(TEST_ID)).attempt.id;
    const ans = [...readingMiniMock01Keys].map((k) => d(k.questionId, right(k.questionId)));
    for (const id of ['rd01-q03', 'rd01-q04', 'rd01-q05', 'rd01-q11', 'rd01-q12']) ans.find((a) => a.questionId === id)!.answer = 'NOT_GIVEN';
    ans.find((a) => a.questionId === 'rd01-q01')!.unsure = true;
    await s.saveResponses(att, ans);
    const r = await s.submitAttempt(att, 'learner_submitted');
    eligible = r.review.filter((x) => x.outcome !== 'correct' || x.unsure).length;
  });
  it('cannot save mistakes before the attempt is submitted, or from someone else’s attempt', async () => {
    const V = await createUser(db, 'v2@example.com'); const sv = svc(V); const open = (await sv.startOrResumeAttempt(TEST_ID)).attempt.id;
    await expect(sv.addToVault(open)).rejects.toMatchObject({ code: 'conflict' });
    await expect(svc(V).addToVault(att)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('eligibility is decided by the server’s stored report; duplicates are skipped', async () => {
    const s = svc(U);
    expect((await s.addToVault(att, ['rd01-q02'])).added).toBe(0);            // q02 was answered correctly and not unsure → refused
    const r1 = await s.addToVault(att);
    expect(r1.added).toBe(eligible); expect(eligible).toBeGreaterThan(1);
    expect(await s.addToVault(att)).toEqual({ added: 0, skipped: eligible });
    const vault = await s.listVault();
    expect(vault).toHaveLength(eligible);
    expect(vault.find((v) => v.questionId === 'rd01-q01')).toMatchObject({ reason: 'unsure', status: 'new', skillTags: expect.any(Array) });
  });
  it('the vault is private: another learner sees none of it and cannot rate it', async () => {
    const W = await createUser(db, 'v3@example.com');
    expect(await svc(W).listVault()).toEqual([]);
    const item = (await svc(U).listVault())[0];
    await expect(svc(W).selfRateVaultItem(item.id, 'needs_practice')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('self-rating "understood" never masters an item', async () => {
    const s = svc(U); const item = (await s.listVault()).find((v) => v.questionId === 'rd01-q03')!;
    expect(await s.selfRateVaultItem(item.id, 'understood')).toMatchObject({ selfRating: 'understood', status: 'new' });
    await expect(s.selfRateVaultItem(item.id, 'mastered' as any)).rejects.toBeInstanceOf(ServiceError);
  });

  describe('targeted practice', () => {
    it('recommends fresh bank questions for the weak skill, with a reason', async () => {
      const recs = await svc(U).getRecommendations();
      const rec = recs.find((r) => r.skill === 'identifying_writer_claims')!;
      expect(rec).toBeDefined(); expect(rec.reason).toMatch(/incorrectly/);
      expect(rec.questionIds.every((id) => id.startsWith('pb-'))).toBe(true);
    });
    it('a recommended session can only contain real published questions; the session is private and refresh-safe', async () => {
      const s = svc(U);
      await expect(s.createPracticeSession({ mode: 'recommended', questionIds: ['nope'] })).rejects.toBeInstanceOf(ServiceError);
      await expect(s.createPracticeSession({ mode: 'recommended', questionIds: [] })).rejects.toBeInstanceOf(ServiceError);
      const rec = (await s.getRecommendations())[0];
      const a = await s.createPracticeSession({ mode: 'recommended', skill: rec.skill, questionIds: rec.questionIds });
      const b = await s.createPracticeSession({ mode: 'recommended', skill: rec.skill, questionIds: rec.questionIds });
      expect(b.id).toBe(a.id);
      const content = (await s.getPracticeSession(a.id))!;
      expect(content.questions).toHaveLength(rec.questionIds.length);
      expect(JSON.stringify(content)).not.toMatch(/"explanation"|"accepted"|"rule"/);
      expect(await svc(await createUser(db, 'snoop@example.com')).getPracticeSession(a.id)).toBeNull();
    });
    it('grading is server-side: correct answers are marked right, wrong ones wrong; double submit is idempotent', async () => {
      const s = svc(U); const rec = (await s.getRecommendations())[0];
      const sess = await s.createPracticeSession({ mode: 'recommended', skill: rec.skill, questionIds: rec.questionIds });
      const qs = (await s.getPracticeSession(sess.id))!.questions;
      const answers: Record<string, string> = {};
      qs.forEach((q, i) => { const k = practiceBankKeys.find((x) => x.questionId === q.id)!; const good = k.rule.kind === 'single' ? k.rule.correct : k.rule.kind === 'text' ? k.rule.accepted[0] : ''; const wrong = q.options ? q.options.find((o) => o.id !== good)!.id : 'definitely-wrong'; answers[q.id] = i === 0 ? good : wrong; });
      await expect(s.submitPracticeSession(sess.id, {})).rejects.toMatchObject({ code: 'empty' });
      await expect(s.submitPracticeSession(sess.id, { [qs[0].id]: ['x'] as any })).rejects.toMatchObject({ code: 'invalid' });
      const done = await s.submitPracticeSession(sess.id, answers);
      expect(done.status).toBe('completed');
      expect(done.grades![0]).toMatchObject({ outcome: 'correct' });
      expect(done.grades!.slice(1).every((g) => g.outcome !== 'correct')).toBe(true);
      expect(done.grades![0].explanation.length).toBeGreaterThan(20);
      const again = await s.submitPracticeSession(sess.id, Object.fromEntries(qs.map((q) => [q.id, 'whatever'])));
      expect(again.grades).toEqual(done.grades);                                  // cannot be re-graded with other answers
      expect(await count(`activity_events where user_id = $1 and event_type = 'practice_completed'`, [U])).toBe(1);
      expect((await s.getAnswerRecords()).filter((r) => r.source === 'practice')).toHaveLength(qs.length);
    });
    it('mastery needs a streak AND a fresh related question — vault progress is updated only by graded practice', async () => {
      const s = svc(U); const item = (await s.listVault()).find((v) => v.questionId === 'rd01-q03')!;
      const before = (await s.listVault()).find((v) => v.id === item.id)!;
      expect(before.status).not.toBe('mastered');
      for (let i = 0; i < 2; i++) { const t = await s.createPracticeSession({ mode: 'vault_retry', vaultItemId: item.id }); await s.submitPracticeSession(t.id, { 'rd01-q03': 'TRUE' }); }
      let cur = (await s.listVault()).find((v) => v.id === item.id)!;
      expect(cur).toMatchObject({ status: 'learning', correctStreak: 2, freshCorrect: 0, reviewCount: 2 });
      const fresh = await s.createPracticeSession({ mode: 'vault_fresh', vaultItemId: item.id });
      expect(fresh.questionIds[0]).toMatch(/^pb-/);
      const q = (await s.getPracticeSession(fresh.id))!.questions[0];
      const k = practiceBankKeys.find((x) => x.questionId === q.id)!;
      await s.submitPracticeSession(fresh.id, { [q.id]: k.rule.kind === 'single' ? k.rule.correct : k.rule.kind === 'text' ? k.rule.accepted[0] : '' });
      cur = (await s.listVault()).find((v) => v.id === item.id)!;
      expect(cur.status).toBe('mastered');
    });
    it('a wrong retry resets the streak', async () => {
      const s = svc(U); const item = (await s.listVault()).find((v) => v.questionId === 'rd01-q04')!;
      const t = await s.createPracticeSession({ mode: 'vault_retry', vaultItemId: item.id });
      await s.submitPracticeSession(t.id, { 'rd01-q04': 'TRUE' });
      expect((await s.listVault()).find((v) => v.id === item.id)).toMatchObject({ status: 'learning', correctStreak: 0, reviewCount: 1 });
    });
    it('the server refuses forged "fresh" questions: the item itself, non-bank, off-skill, unknown, multiple, or already answered', async () => {
      const raw = pgClient(db, user(U)); const s = svc(U);
      const item = (await s.listVault()).find((v) => v.questionId === 'rd01-q12')!;      // skills: identifying_writer_claims, paraphrase_recognition
      const call = (ids: string[]) => raw.rpc('create_practice_session', { p_mode: 'vault_fresh', p_skill: null, p_question_ids: ids, p_vault_item_id: item.id });
      const cases: [string, string[]][] = [['the vault item itself', ['rd01-q12']], ['a mock question (not in the bank)', ['rd01-q01']], ['off-skill bank question', ['pb-q13']], ['unknown id', ['nope']], ['two ids', ['pb-q06', 'pb-q11']]];
      for (const [label, ids] of cases) expect((await call(ids) as any).error, label).toBeTruthy();
      const answered = (await s.getAnswerRecords()).find((r) => r.source === 'practice' && r.skillTags.includes('identifying_writer_claims'))!;
      expect((await call([answered.questionId]) as any).error, 'already answered').toBeTruthy();
    });
    it('another learner cannot start or grade sessions against my vault items or sessions', async () => {
      const X = await createUser(db, 'x@example.com'); const sx = svc(X); const item = (await svc(U).listVault())[0];
      await expect(sx.createPracticeSession({ mode: 'vault_retry', vaultItemId: item.id })).rejects.toMatchObject({ code: 'not_found' });
      const sess = await svc(U).createPracticeSession({ mode: 'vault_retry', vaultItemId: item.id });
      await expect(sx.submitPracticeSession(sess.id, { [item.questionId]: 'TRUE' })).rejects.toMatchObject({ code: 'not_found' });
    });
  });
});

describe('rate limiting', () => {
  it('start_or_resume_attempt is capped per learner per minute, and recovers when the window passes', async () => {
    const R = await createUser(db, 'rapid@example.com'); const s = svc(R);
    for (let i = 0; i < 30; i++) await s.startOrResumeAttempt(TEST_ID);
    await expect(s.startOrResumeAttempt(TEST_ID)).rejects.toMatchObject({ code: 'rate_limited' });
    expect(await svc(await createUser(db, 'calm@example.com')).startOrResumeAttempt(TEST_ID)).toBeTruthy();   // others unaffected
    await db.query(`update rate_limits set window_start = now() - interval '2 minutes' where user_id = $1`, [R]);
    await expect(s.startOrResumeAttempt(TEST_ID)).resolves.toBeTruthy();
  });
  it('the submit handler reports 429 when its bucket is exhausted', async () => {
    const R = await createUser(db, 'sub@example.com'); const c = pgClient(db, user(R)); const att = (await new SupabaseAssessments(c).startOrResumeAttempt(TEST_ID)).attempt.id;
    for (let i = 0; i < 30; i++) await c.functions.invoke('submit-attempt', { body: { attemptId: att, kind: 'learner_submitted' } });
    const over: any = await c.functions.invoke('submit-attempt', { body: { attemptId: att, kind: 'learner_submitted' } });
    expect(over.error.context.status).toBe(429);
  });
});

describe('request validation & failure handling', () => {
  it('rejects malformed submit requests and unauthenticated callers with proper statuses', async () => {
    const R = await createUser(db, 'bad@example.com'); const c = pgClient(db, user(R));
    for (const body of [null, {}, { attemptId: 'nope', kind: 'learner_submitted' }, { attemptId: '00000000-0000-0000-0000-000000000000', kind: 'cheat' }]) {
      const r: any = await c.functions.invoke('submit-attempt', { body }); expect(r.error.context.status, JSON.stringify(body)).toBe(400);
    }
    const missing: any = await c.functions.invoke('submit-attempt', { body: { attemptId: '00000000-0000-0000-0000-000000000000', kind: 'learner_submitted' } });
    expect(missing.error.context.status).toBe(404);
    const guest: any = await pgClient(db, anon).functions.invoke('submit-attempt', { body: {} });
    expect(guest.error.context.status).toBe(401);
  });
  it('database failures never leak internals to the client (500 with a generic body)', async () => {
    const { submitAttemptHandler, supabaseDb } = await import('@/server');
    const broken = supabaseDb({ rpc: async () => ({ data: null, error: { message: 'relation "answer_keys" secret detail', code: 'XX000' } }) });
    const out = await submitAttemptHandler(broken, '00000000-0000-0000-0000-000000000001', { attemptId: '00000000-0000-0000-0000-000000000002', kind: 'learner_submitted' });
    expect(out).toEqual({ status: 500, body: { error: 'internal_error' } });
  });
  it('adapter error mapping: network, auth and DB errors become learner-safe messages', async () => {
    const mk = (error: any) => new SupabaseAssessments({ rpc: async () => ({ data: null, error }), functions: { invoke: async () => ({ data: null, error: null }) }, auth: null, from: () => null } as any);
    await expect(mk({ message: 'TypeError: Failed to fetch' }).listVault()).rejects.toMatchObject({ code: 'network' });
    await expect(mk({ message: 'x', code: '54000' }).listVault()).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(mk({ message: 'JWT expired', code: 'PGRST301' }).listVault()).rejects.toMatchObject({ code: 'unauthenticated' });
    const e = await mk({ message: 'relation "answer_keys" does not exist', code: '42P01' }).listVault().catch((x) => x);
    expect(String(e.message)).not.toMatch(/answer_keys|relation/);
  });
});

describe('account deletion via the adapter', () => {
  it('removes the account and every learner row', async () => {
    const Z = await createUser(db, 'bye@example.com'); const s = svc(Z);
    const att = (await s.startOrResumeAttempt(TEST_ID)).attempt.id; await s.saveResponses(att, [d('rd01-q01', 'B')]); await s.submitAttempt(att, 'learner_submitted'); await s.addToVault(att);
    expect(await count('mistake_items where user_id = $1', [Z])).toBeGreaterThan(0);
    const out = await pgClient(db, user(Z)).functions.invoke('delete-account');
    expect(out.error).toBeNull();
    for (const [t, c] of [['profiles', 'id'], ['test_attempts', 'user_id'], ['mistake_items', 'user_id'], ['activity_events', 'user_id'], ['rate_limits', 'user_id']]) expect(await count(`${t} where ${c} = $1`, [Z]), t).toBe(0);
    expect(await count('results where attempt_id = $1', [att])).toBe(0);
    expect(await count('responses where attempt_id = $1', [att])).toBe(0);
  });
});

describe('upgrade path: 0004 applies on top of an existing 0001–0003 database', () => {
  it('keeps existing data and enables the new functions', async () => {
    const { PGlite } = await import('@electric-sql/pglite'); const { readFileSync } = await import('node:fs'); const { join } = await import('node:path');
    const root = join(__dirname, '..', '..', 'supabase'); const old = new PGlite();
    for (const f of ['tests/00_supabase_shim.sql', 'migrations/0001_schema.sql', 'migrations/0002_rls.sql', 'migrations/0003_functions.sql', 'seed.sql']) await old.exec(readFileSync(join(root, f), 'utf8'));
    const uid = (await old.query<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ('old@example.com', '{"display_name":"Old User"}') returning id`)).rows[0].id;
    await as(old, user(uid), (q) => q(`select start_or_resume_attempt($1)`, [TEST_ID]));
    await old.exec(readFileSync(join(root, 'migrations/0004_backend_completion.sql'), 'utf8'));
    const s = new SupabaseAssessments(pgClient(old, user(uid)));
    const resumed = await s.startOrResumeAttempt(TEST_ID);
    expect(resumed.attempt.status).toBe('in_progress');
    expect(await s.listAttempts()).toHaveLength(1);
    expect(await s.listVault()).toEqual([]);
    const tiny = (await old.query<{ id: string }>(`insert into auth.users (email) values ('c@x.com') returning id`)).rows[0].id;   // the sign-up bug case
    expect((await old.query<{ display_name: string }>(`select display_name from profiles where id = $1`, [tiny])).rows[0].display_name).toBe('c@x.com'.split('@')[0].length < 2 ? 'Learner' : 'c');
    await old.close();
  });
});
void owner;
