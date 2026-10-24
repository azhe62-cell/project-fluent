import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalServices } from './index';
import { MemoryStore } from './storage';
import type { Services } from '../types';
import { ServiceError } from '../types';
import type { ResponseDraft } from '@/engine';
import { readingMiniMock01Keys } from '@/content/reading-mini-mock-01.keys';

const T0 = Date.parse('2026-03-01T10:00:00.000Z');
let clock = T0;
const TEST_ID = 'test-reading-mini-01';
let store: MemoryStore;
let svc: Services;
let seq = 0;

const draft = (questionId: string, answer: ResponseDraft['answer'], over: Partial<ResponseDraft> = {}): ResponseDraft =>
  ({ questionId, answer, flagged: false, unsure: false, seq: ++seq, ...over });
const correctFor = (id: string) => {
  const k = readingMiniMock01Keys.find((x) => x.questionId === id)!;
  return k.rule.kind === 'text' ? k.rule.accepted[0] : k.rule.correct;
};

beforeEach(async () => {
  clock = T0; seq = 0; store = new MemoryStore();
  svc = createLocalServices(store, () => new Date(clock));
  await svc.auth.signUp({ email: 'a@example.com', displayName: 'Ayesha' });
});

describe('attempt start / resume / recovery', () => {
  it('creates a server-timed attempt and never ships answer data to the learner', async () => {
    const s = await svc.assessments.startOrResumeAttempt(TEST_ID);
    expect(s.attempt.status).toBe('in_progress');
    expect(Date.parse(s.attempt.deadlineAt!) - Date.parse(s.attempt.startedAt!)).toBe(20 * 60 * 1000);
    expect(s.serverNow).toBe(new Date(T0).toISOString());
    const json = JSON.stringify(s.test);
    for (const banned of ['"correct"', '"accepted"', '"explanation"', '"rule"']) expect(json).not.toContain(banned);
  });

  it('a refresh resumes the SAME attempt instead of creating a second one', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    const b = await svc.assessments.startOrResumeAttempt(TEST_ID);
    expect(b.attempt.id).toBe(a.attempt.id);
    expect((await svc.assessments.listAttempts())).toHaveLength(1);
  });

  it('saved answers survive a reload (new service instance over the same storage)', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    await svc.assessments.saveResponses(a.attempt.id, [draft('rd01-q01', 'B'), draft('rd01-q06', 'common', { flagged: true })]);
    const reloaded = createLocalServices(store, () => new Date(clock));
    const s = await reloaded.assessments.getAttempt(a.attempt.id);
    expect(s!.responses['rd01-q01'].answer).toBe('B');
    expect(s!.responses['rd01-q06']).toMatchObject({ answer: 'common', flagged: true });
  });

  it('stale and out-of-order saves cannot overwrite a newer answer; invalid answers are rejected', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    await svc.assessments.saveResponses(a.attempt.id, [{ ...draft('rd01-q01', 'C'), seq: 10 }]);
    const r = await svc.assessments.saveResponses(a.attempt.id, [{ ...draft('rd01-q01', 'A'), seq: 4 }, draft('rd01-q02', 'Z'), draft('nope', 'A')]);
    expect(r.stale).toBe(1);
    expect(r.rejected.map((x) => x.questionId).sort()).toEqual(['nope', 'rd01-q02']);
    expect((await svc.assessments.getAttempt(a.attempt.id))!.responses['rd01-q01'].answer).toBe('C');
  });
});

describe('submission', () => {
  it('scores on submit, stores one result, and a double-click creates no duplicate', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    await svc.assessments.saveResponses(a.attempt.id, [
      draft('rd01-q01', 'B'), draft('rd01-q03', 'TRUE'), draft('rd01-q04', 'TRUE'), draft('rd01-q06', 'common'), draft('rd01-q09', ['A', 'B']),
    ]);
    clock = T0 + 600_000;
    const [r1, r2] = await Promise.all([
      svc.assessments.submitAttempt(a.attempt.id, 'learner_submitted'),
      svc.assessments.submitAttempt(a.attempt.id, 'learner_submitted'),
    ]);
    expect(r2).toEqual(r1);
    const r3 = await svc.assessments.submitAttempt(a.attempt.id, 'learner_submitted'); // retry after the fact
    expect(r3).toEqual(r1);

    // q01 ✓, q03 ✓, q04 ✗, q06 ✓, q09 partial (1 of 2) → 3 + 1 = 4
    expect(r1.score.rawScore).toBe(4);
    expect(r1.score.maxScore).toBe(20);
    expect(r1.score.counts).toEqual({ correct: 3, incorrect: 1, partial: 1, unanswered: 14 });
    expect(r1.submissionKind).toBe('learner_submitted');
    expect(r1.timeUsedSeconds).toBe(600);
    expect(r1.score.scoringVersion).toBe('reading-raw-v1');

    expect(await svc.assessments.listResults()).toHaveLength(1);
    expect(await svc.assessments.getActivity()).toHaveLength(1);              // not double-counted
    expect((await svc.assessments.getAnswerRecords())).toHaveLength(19);       // one record per question, once
    expect((await svc.assessments.listAttempts())[0].status).toBe('scored');
  });

  it('after submission the attempt is locked: further saves are refused', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    await svc.assessments.submitAttempt(a.attempt.id, 'learner_submitted');
    const r = await svc.assessments.saveResponses(a.attempt.id, [draft('rd01-q01', 'B')]);
    expect(r.fatal).toBe('not_in_progress');
    expect((await svc.assessments.getResult(a.attempt.id))!.score.counts.unanswered).toBe(19);
  });

  it('review contains answers/explanations ONLY after submission', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    expect(await svc.assessments.getResult(a.attempt.id)).toBeNull();
    const res = await svc.assessments.submitAttempt(a.attempt.id, 'learner_submitted');
    expect(res.review.find((r) => r.questionId === 'rd01-q05')).toMatchObject({ correctDisplay: 'Not Given', outcome: 'unanswered' });
    expect(res.review[0].explanation.length).toBeGreaterThan(30);
  });
});

describe('deadline & expiry', () => {
  it('saves after the deadline (+grace) are refused; submitting then is recorded as EXPIRED and scored only on pre-deadline answers', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    await svc.assessments.saveResponses(a.attempt.id, [draft('rd01-q01', 'B')]);
    clock = T0 + 20 * 60_000 + 10_000; // 10 s after the deadline > 5 s grace
    const late = await svc.assessments.saveResponses(a.attempt.id, [draft('rd01-q02', 'C')]);
    expect(late.fatal).toBe('deadline_passed');
    const res = await svc.assessments.submitAttempt(a.attempt.id, 'learner_submitted');
    expect(res.submissionKind).toBe('time_expired');
    expect(res.timeUsedSeconds).toBe(1200);
    expect(res.score.rawScore).toBe(1);
    expect(res.review.find((r) => r.questionId === 'rd01-q02')!.outcome).toBe('unanswered');
  });

  it('a timer-triggered submit within grace is accepted with the late answer', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    clock = T0 + 20 * 60_000 + 2_000;
    const ok = await svc.assessments.saveResponses(a.attempt.id, [draft('rd01-q01', 'B')]);
    expect(ok.fatal).toBeUndefined();
    const res = await svc.assessments.submitAttempt(a.attempt.id, 'time_expired');
    expect(res.submissionKind).toBe('time_expired');
    expect(res.score.rawScore).toBe(1);
  });

  it('an abandoned attempt is expired explicitly when the learner returns, and a fresh attempt starts', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    clock = T0 + 3 * 3600_000;
    const b = await svc.assessments.startOrResumeAttempt(TEST_ID);
    expect(b.attempt.id).not.toBe(a.attempt.id);
    const old = await svc.assessments.getResult(a.attempt.id);
    expect(old!.submissionKind).toBe('time_expired');
    expect(old!.score.rawScore).toBe(0);
  });

  it('getAttempt on an overdue attempt returns it as finalised, never as a live exam', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    clock = T0 + 2 * 3600_000;
    const s = await svc.assessments.getAttempt(a.attempt.id);
    expect(s!.attempt.status).toBe('scored');
  });
});

describe('ownership & authentication', () => {
  it('another learner cannot read, save to, submit or see results for someone else’s attempt', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    await svc.assessments.submitAttempt(a.attempt.id, 'learner_submitted');
    const b = await svc.assessments.startOrResumeAttempt(TEST_ID); // second attempt, still A
    await svc.auth.signOut();
    await svc.auth.signUp({ email: 'b@example.com', displayName: 'Bilal' });

    expect(await svc.assessments.getAttempt(b.attempt.id)).toBeNull();
    expect(await svc.assessments.getResult(a.attempt.id)).toBeNull();
    await expect(svc.assessments.saveResponses(b.attempt.id, [draft('rd01-q01', 'B')])).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.assessments.submitAttempt(b.attempt.id, 'learner_submitted')).rejects.toBeInstanceOf(ServiceError);
    expect(await svc.assessments.listAttempts()).toEqual([]);
    expect(await svc.assessments.listVault()).toEqual([]);
  });

  it('without a session the data layer refuses to work', async () => {
    await svc.auth.signOut();
    await expect(svc.assessments.startOrResumeAttempt(TEST_ID)).rejects.toThrow(/Not signed in/);
  });

  it('deleting the account removes the learner data', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    await svc.assessments.submitAttempt(a.attempt.id, 'learner_submitted');
    await svc.auth.deleteAccount();
    expect(store.keys().filter((k) => k.includes('.data.'))).toEqual([]);
    await expect(svc.auth.signIn({ email: 'a@example.com' })).rejects.toBeInstanceOf(ServiceError);
  });
});

describe('Exam-to-Mastery loop', () => {
  const sit = async (answers: Record<string, ResponseDraft['answer']>, unsure: string[] = []) => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    await svc.assessments.saveResponses(a.attempt.id, Object.entries(answers).map(([q, v]) => draft(q, v, { unsure: unsure.includes(q) })));
    return svc.assessments.submitAttempt(a.attempt.id, 'learner_submitted');
  };
  // Gets every True/False/Not Given item wrong, everything else right.
  const tfngWrong = () => {
    const ans: Record<string, ResponseDraft['answer']> = {};
    for (const k of readingMiniMock01Keys) ans[k.questionId] = correctFor(k.questionId);
    for (const id of ['rd01-q03', 'rd01-q04', 'rd01-q05', 'rd01-q11', 'rd01-q12', 'rd01-q13']) ans[id] = 'NOT_GIVEN';
    ans['rd01-q05'] = 'TRUE'; ans['rd01-q13'] = 'TRUE';
    return ans;
  };

  it('saves only eligible mistakes, once, privately', async () => {
    const res = await sit(tfngWrong(), ['rd01-q01']);
    const r1 = await svc.assessments.addToVault(res.attemptId);
    // 6 TFNG items: q05 & q13 are wrong, q03 & q04 & q11 & q12... compute from result instead of guessing
    const eligible = res.review.filter((r) => r.outcome !== 'correct' || r.unsure).length;
    expect(r1.added).toBe(eligible);
    expect(eligible).toBeGreaterThan(0);
    const r2 = await svc.assessments.addToVault(res.attemptId);
    expect(r2).toEqual({ added: 0, skipped: eligible });
    const vault = await svc.assessments.listVault();
    expect(vault).toHaveLength(eligible);
    expect(vault.find((v) => v.questionId === 'rd01-q01')!.reason).toBe('unsure'); // correct but unsure
    expect(vault.every((v) => v.status === 'new')).toBe(true);
  });

  it('refuses to save mistakes before the attempt has been submitted', async () => {
    const a = await svc.assessments.startOrResumeAttempt(TEST_ID);
    await expect(svc.assessments.addToVault(a.attempt.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('recommends fresh questions for the weak skill with a plain-language reason, then tracks improvement', async () => {
    await sit(tfngWrong());
    const recs = await svc.assessments.getRecommendations();
    const rec = recs.find((r) => r.skill === 'identifying_writer_claims')!;
    expect(rec).toBeDefined();
    expect(rec.reason).toMatch(/incorrectly/);
    expect(rec.questionIds.every((id) => id.startsWith('pb-'))).toBe(true);   // fresh bank items, not the mock again

    const session = await svc.assessments.createPracticeSession({ mode: 'recommended', skill: rec.skill, questionIds: rec.questionIds });
    const again = await svc.assessments.createPracticeSession({ mode: 'recommended', skill: rec.skill, questionIds: rec.questionIds });
    expect(again.id).toBe(session.id); // refreshing does not spawn duplicate sessions

    const content = await svc.assessments.getPracticeSession(session.id);
    expect(content!.questions.length).toBe(rec.questionIds.length);
    expect(JSON.stringify(content)).not.toContain('"explanation"');

    await expect(svc.assessments.submitPracticeSession(session.id, {})).rejects.toMatchObject({ code: 'empty' });

    const answers = Object.fromEntries(content!.questions.map((q) => [q.id, q.type === 'true_false_not_given' ? 'TRUE' : q.options ? q.options[0].id : 'x']));
    const done = await svc.assessments.submitPracticeSession(session.id, answers);
    expect(done.status).toBe('completed');
    expect(done.grades!.length).toBe(rec.questionIds.length);
    for (const g of done.grades!) expect(g.explanation.length).toBeGreaterThan(20);
    const again2 = await svc.assessments.submitPracticeSession(session.id, answers);
    expect(again2).toEqual(done); // idempotent

    // answered questions are no longer "fresh"
    const next = await svc.assessments.getRecommendations();
    const nextRec = next.find((r) => r.skill === 'identifying_writer_claims');
    if (nextRec) for (const id of rec.questionIds) if (!done.grades!.find((g) => g.questionId === id && g.outcome !== 'correct')) expect(nextRec.questionIds).not.toContain(id);
    expect((await svc.assessments.getActivity()).map((e) => e.type)).toEqual(['attempt_completed', 'practice_completed']);
  });

  it('mastery requires real, graded practice including a fresh related question — never just opening an explanation', async () => {
    const res = await sit(tfngWrong());
    await svc.assessments.addToVault(res.attemptId);
    const item = (await svc.assessments.listVault()).find((v) => v.questionId === 'rd01-q05')!; // TFNG, answered wrongly

    // Same-question retries (correct) are not enough
    for (let i = 0; i < 2; i++) {
      const s = await svc.assessments.createPracticeSession({ mode: 'vault_retry', vaultItemId: item.id });
      await svc.assessments.submitPracticeSession(s.id, { 'rd01-q05': 'NOT_GIVEN' });
    }
    let cur = (await svc.assessments.listVault()).find((v) => v.id === item.id)!;
    expect(cur).toMatchObject({ status: 'learning', correctStreak: 2, freshCorrect: 0 });

    // A correct fresh question completes the rule
    const fresh = await svc.assessments.createPracticeSession({ mode: 'vault_fresh', vaultItemId: item.id });
    expect(fresh.questionIds[0]).toMatch(/^pb-/);
    const fq = (await svc.assessments.getPracticeSession(fresh.id))!.questions[0];
    const key = (await import('@/content/practice-bank.keys')).practiceBankKeys.find((k) => k.questionId === fq.id)!;
    const right = key.rule.kind === 'single' ? key.rule.correct : key.rule.kind === 'text' ? key.rule.accepted[0] : '';
    await svc.assessments.submitPracticeSession(fresh.id, { [fq.id]: right });
    cur = (await svc.assessments.listVault()).find((v) => v.id === item.id)!;
    expect(cur.status).toBe('mastered');
  });

  it('a wrong retry keeps the item in learning and resets its streak; self-rating "understood" never masters it', async () => {
    const res = await sit(tfngWrong());
    await svc.assessments.addToVault(res.attemptId);
    const item = (await svc.assessments.listVault()).find((v) => v.questionId === 'rd01-q05')!;
    const understood = await svc.assessments.selfRateVaultItem(item.id, 'understood');
    expect(understood.status).toBe('new');
    const s = await svc.assessments.createPracticeSession({ mode: 'vault_retry', vaultItemId: item.id });
    await svc.assessments.submitPracticeSession(s.id, { 'rd01-q05': 'TRUE' });
    expect((await svc.assessments.listVault()).find((v) => v.id === item.id)).toMatchObject({ status: 'learning', correctStreak: 0, reviewCount: 1 });
  });
});
