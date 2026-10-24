import { buildReview, gradePractice, PracticeError, scoreAttempt, validateAnswer, type AnswerKey, type AnswerValue, type ResultView } from '@/engine';
import { NotFoundError, RateLimitedError, type ServerDb } from './db';

/**
 * Trusted request handlers. They receive an ALREADY-AUTHENTICATED user id (the Edge Function verifies the
 * JWT) and never read scores, correct answers or user ids from the request body.
 */
export interface HandlerResponse { status: number; body: unknown }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const res = (status: number, body: unknown): HandlerResponse => ({ status, body });

function mapError(e: unknown): HandlerResponse {
  if (e instanceof NotFoundError) return res(404, { error: 'not_found' });
  if (e instanceof RateLimitedError) return res(429, { error: 'rate_limited' });
  if (e instanceof PracticeError) return res(400, { error: e.code, message: e.message });
  return res(500, { error: 'internal_error' });                       // never leak internals
}

export async function submitAttemptHandler(db: ServerDb, userId: string, body: unknown, now: () => Date = () => new Date()): Promise<HandlerResponse> {
  const b = (body ?? {}) as { attemptId?: unknown; kind?: unknown };
  if (typeof b.attemptId !== 'string' || !UUID.test(b.attemptId) || (b.kind !== 'learner_submitted' && b.kind !== 'time_expired')) return res(400, { error: 'invalid_request' });
  try {
    await db.rateLimit(userId, 'submit', 30, 60);
    // Atomic + idempotent in SQL: ownership, deadline and status are decided by the database clock.
    const att = await db.finalizeAttempt(b.attemptId, userId, b.kind);
    if (att.status === 'scored' && att.result_view) return res(200, att.result_view);   // duplicate submit → the one stored result

    const inputs = await db.getScoringInputs(att.id);
    if (!inputs) return res(404, { error: 'not_found' });
    const test = inputs.content;
    const keys = new Map<string, AnswerKey>(inputs.keys.map((k) => [k.questionId, k]));
    const qById = new Map(test.questions.map((q) => [q.id, q]));
    const responses: Record<string, AnswerValue> = {}; const unsure: Record<string, boolean> = {};
    for (const r of inputs.responses) {
      const q = qById.get(r.questionId); if (!q) continue;
      responses[r.questionId] = validateAnswer(q, r.answer as AnswerValue).ok ? (r.answer as AnswerValue) : null;   // malformed → unanswered
      unsure[r.questionId] = r.unsure;
    }
    const score = scoreAttempt({ questions: test.questions, sections: test.sections, keys, responses, scoredAt: now().toISOString() });
    const review = buildReview({ questions: test.questions, keys, responses, unsure, score });
    const result: ResultView = {
      attemptId: att.id, testId: test.id, testTitle: test.title, testVersion: inputs.versionNumber, submissionKind: att.submission_kind,
      submittedAt: att.submitted_at, timeUsedSeconds: att.time_used_seconds ?? 0, score, review, scoringNote: test.scoringNote,
    };
    const stored = await db.storeResult(att.id, result, review.filter((r) => r.outcome !== 'unanswered').length);
    return res(200, stored);
  } catch (e) { return mapError(e); }
}

export async function submitPracticeHandler(db: ServerDb, userId: string, body: unknown, now: () => Date = () => new Date()): Promise<HandlerResponse> {
  const b = (body ?? {}) as { sessionId?: unknown; answers?: unknown };
  if (typeof b.sessionId !== 'string' || !UUID.test(b.sessionId) || typeof b.answers !== 'object' || b.answers === null || Array.isArray(b.answers)) return res(400, { error: 'invalid_request' });
  const entries = Object.entries(b.answers as Record<string, unknown>);
  const shapeOk = entries.length <= 30 && entries.every(([k, v]) => k.length <= 64 && (v === null || (typeof v === 'string' && v.length <= 200) || (Array.isArray(v) && v.length <= 10 && v.every((x) => typeof x === 'string' && x.length <= 64))));
  if (!shapeOk) return res(400, { error: 'invalid_request' });
  try {
    await db.rateLimit(userId, 'practice_submit', 60, 60);
    const input = await db.getPracticeForGrading(b.sessionId, userId);
    if (!input) return res(404, { error: 'not_found' });
    if (input.session.status === 'completed') return res(200, input.session);             // idempotent
    const keys = await db.getAnswerKeys(input.session.questionIds);
    const { grades, vaultUpdates, answered } = gradePractice({ session: input.session, questions: input.questions, keys, answers: b.answers as Record<string, AnswerValue>, vault: input.vault, now: now() });
    return res(200, await db.storePracticeResult(input.session.id, userId, grades, vaultUpdates, answered));
  } catch (e) { return mapError(e); }
}
