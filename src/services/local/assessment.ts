import {
  applyIncomingResponse, beginAttempt, buildReview, canAcceptResponses, finalizeAttempt, gradePractice,
  isPastDeadline, markScored, PracticeError, pickFreshForVault, scoreAttempt, timeUsedSeconds, validateAnswer,
  type AnswerKey, type AnswerValue, type Attempt, type Passage, type PublicQuestion, type ResponseDraft,
  type ResultView, type SubmissionKind,
} from '@/engine';
import { addToVault, selfRate, vaultCandidates, type SelfRating, type VaultItem } from '@/engine/vault';
import { recommendPractice, type AnswerRecord } from '@/engine/recommend';
import type { ActivityEvent } from '@/engine/streak';
import { findTestById, findTestBySlug, practiceBank, publishedTests } from '@/content/index.public';
import {
  ServiceError, type AssessmentService, type AttemptSession, type PracticeContent,
  type PracticeSession, type SaveResult, type TestSummary,
} from '../types';
import { dataKey } from './auth';
import type { KeyValueStore } from './storage';

/**
 * LOCAL DEVELOPMENT ADAPTER — NOT SECURE.
 *
 * It runs the same engine the server would run (scoring, deadline checks, merge rules,
 * idempotent submit), but inside the browser, with data in localStorage. Because the answer
 * keys are loaded into the page, a curious learner COULD read them from devtools. That is
 * exactly what the Supabase path (Edge Function + RLS) prevents. Use this adapter to explore
 * the product and to test engine behaviour — never to host real learners.
 */

interface UserData {
  attempts: Attempt[];
  responses: Record<string, Record<string, ResponseDraft & { savedAt: string }>>;
  results: Record<string, ResultView>;
  vault: VaultItem[];
  practice: PracticeSession[];
  records: AnswerRecord[];
  activity: ActivityEvent[];
}
const emptyData = (): UserData => ({ attempts: [], responses: {}, results: {}, vault: [], practice: [], records: [], activity: [] });

const allQuestions = (): PublicQuestion[] => [...publishedTests.flatMap((t) => t.questions), ...practiceBank.questions];
const allPassages = (): Passage[] => [...publishedTests.flatMap((t) => t.passages), ...practiceBank.passages];

const loadKeys = async (): Promise<Map<string, AnswerKey>> => (await import('@/content/index.keys')).answerKeyMap;

export class LocalAssessmentService implements AssessmentService {
  mode = 'local' as const;
  capabilities = { assessments: true, vault: true, practice: true };
  private inflightSubmit = new Map<string, Promise<ResultView>>();

  constructor(
    private store: KeyValueStore,
    private getUserId: () => string,
    private now: () => Date = () => new Date(),
  ) {}

  // ------------------------------------------------------------ persistence
  private load(): UserData {
    try { return { ...emptyData(), ...JSON.parse(this.store.getItem(dataKey(this.getUserId())) ?? '{}') }; }
    catch { return emptyData(); }
  }
  private save(d: UserData) { this.store.setItem(dataKey(this.getUserId()), JSON.stringify(d)); }
  private owned(d: UserData, attemptId: string): Attempt {
    const a = d.attempts.find((x) => x.id === attemptId && x.userId === this.getUserId());
    if (!a) throw new ServiceError('not_found', 'Attempt not found.');
    return a;
  }

  // ------------------------------------------------------------ catalogue
  async listTests(): Promise<TestSummary[]> {
    return publishedTests.map((t) => ({
      id: t.id, slug: t.slug, title: t.title, description: t.description, assessmentType: t.assessmentType,
      durationSeconds: t.durationSeconds, questionCount: t.questions.length,
      totalMarks: t.questions.reduce((a, q) => a + q.marks, 0), version: t.version, passageCount: t.passages.length,
    }));
  }
  async getTest(slug: string) { return findTestBySlug(slug) ?? null; }

  // ------------------------------------------------------------ attempts
  private session(d: UserData, a: Attempt): AttemptSession {
    const test = findTestById(a.testId)!;
    const responses: Record<string, ResponseDraft> = {};
    for (const [qid, r] of Object.entries(d.responses[a.id] ?? {})) responses[qid] = { questionId: qid, answer: r.answer, flagged: r.flagged, unsure: r.unsure, seq: r.seq };
    return { attempt: a, test, responses, serverNow: this.now().toISOString() };
  }

  /** Synchronous critical section: finalise, score, persist. Requires keys already loaded. */
  private finalizeAndScore(d: UserData, a: Attempt, keys: Map<string, AnswerKey>, kind: SubmissionKind): ResultView {
    const now = this.now();
    const { attempt: fin } = finalizeAttempt(a, now, kind);
    const test = findTestById(a.testId)!;
    const stored = d.responses[a.id] ?? {};
    const responses: Record<string, AnswerValue> = {}; const unsure: Record<string, boolean> = {};
    for (const [qid, r] of Object.entries(stored)) { responses[qid] = r.answer; unsure[qid] = r.unsure; }
    const score = scoreAttempt({ questions: test.questions, sections: test.sections, keys, responses, scoredAt: now.toISOString() });
    const review = buildReview({ questions: test.questions, keys, responses, unsure, score });
    const scored = markScored(fin);
    const result: ResultView = {
      attemptId: a.id, testId: test.id, testTitle: test.title, testVersion: a.testVersion,
      submissionKind: scored.submissionKind!, submittedAt: scored.submittedAt!, timeUsedSeconds: timeUsedSeconds(scored),
      score, review, scoringNote: test.scoringNote,
    };
    d.attempts = d.attempts.map((x) => (x.id === a.id ? scored : x));
    d.results[a.id] = result; // keyed by attempt id: structurally impossible to store two results
    const at = now.toISOString();
    for (const r of review) d.records.push({ questionId: r.questionId, skillTags: r.skillTags, correct: r.outcome === 'correct', at, source: 'mock' });
    d.activity.push({ type: 'attempt_completed', at, questions: review.filter((r) => r.outcome !== 'unanswered').length });
    return result;
  }

  async startOrResumeAttempt(testId: string): Promise<AttemptSession> {
    const test = findTestById(testId);
    if (!test) throw new ServiceError('not_found', 'That test is not available.');
    const keys = await loadKeys(); // load before the synchronous section
    const d = this.load(); const now = this.now();
    let existing = d.attempts.find((a) => a.testId === testId && a.userId === this.getUserId() && a.status === 'in_progress');
    if (existing && isPastDeadline(existing, now)) { this.finalizeAndScore(d, existing, keys, 'time_expired'); existing = undefined; }
    if (existing) { this.save(d); return this.session(d, existing); }
    const created: Attempt = {
      id: crypto.randomUUID(), userId: this.getUserId(), testId, testVersion: test.version, status: 'created',
      createdAt: now.toISOString(), startedAt: null, deadlineAt: null, submittedAt: null, submissionKind: null,
    };
    const attempt = beginAttempt(created, now, test.durationSeconds);
    d.attempts.push(attempt); d.responses[attempt.id] = {};
    this.save(d);
    return this.session(d, attempt);
  }

  async getAttempt(attemptId: string): Promise<AttemptSession | null> {
    const keys = await loadKeys();
    const d = this.load();
    const a = d.attempts.find((x) => x.id === attemptId && x.userId === this.getUserId());
    if (!a) return null;
    if (a.status === 'in_progress' && isPastDeadline(a, this.now())) {
      this.finalizeAndScore(d, a, keys, 'time_expired'); this.save(d);
      return this.session(d, d.attempts.find((x) => x.id === attemptId)!);
    }
    return this.session(d, a);
  }

  async saveResponses(attemptId: string, drafts: ResponseDraft[]): Promise<SaveResult> {
    const d = this.load(); const a = this.owned(d, attemptId); const now = this.now();
    const base = { serverNow: now.toISOString(), applied: 0, stale: 0, rejected: [] as SaveResult['rejected'] };
    const gate = canAcceptResponses(a, now);
    if (!gate.ok) return { ...base, fatal: gate.reason };
    const test = findTestById(a.testId)!;
    const byId = new Map(test.questions.map((q) => [q.id, q]));
    const store = (d.responses[attemptId] ??= {});
    const out = { ...base };
    for (const dr of drafts) {
      const q = byId.get(dr.questionId);
      if (!q) { out.rejected.push({ questionId: dr.questionId, reason: 'Unknown question.' }); continue; }
      const v = validateAnswer(q, dr.answer);
      if (!v.ok) { out.rejected.push({ questionId: dr.questionId, reason: v.reason }); continue; }
      const { value, applied } = applyIncomingResponse(store[dr.questionId], { ...dr, savedAt: now.toISOString() });
      store[dr.questionId] = value;
      applied ? out.applied++ : out.stale++;
    }
    this.save(d);
    return out;
  }

  async submitAttempt(attemptId: string, kind: SubmissionKind): Promise<ResultView> {
    // Double-click / retry safety: concurrent calls share one operation.
    const running = this.inflightSubmit.get(attemptId);
    if (running) return running;
    const op = (async () => {
      const keys = await loadKeys();
      const d = this.load(); const a = this.owned(d, attemptId);
      const existing = d.results[attemptId];
      if (existing) return existing; // already scored → return stored result, create nothing
      const result = this.finalizeAndScore(d, a, keys, kind);
      this.save(d);
      return result;
    })().finally(() => this.inflightSubmit.delete(attemptId));
    this.inflightSubmit.set(attemptId, op);
    return op;
  }

  async getResult(attemptId: string) {
    const d = this.load();
    if (!d.attempts.some((a) => a.id === attemptId && a.userId === this.getUserId())) return null;
    return d.results[attemptId] ?? null;
  }
  async listResults() { return Object.values(this.load().results).sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)); }
  async listAttempts() { return [...this.load().attempts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)); }

  // ------------------------------------------------------------ mistake vault
  async listVault() { return this.load().vault; }

  async addToVault(attemptId: string, questionIds?: string[]) {
    const d = this.load(); this.owned(d, attemptId);
    const result = d.results[attemptId];
    if (!result) throw new ServiceError('conflict', 'Mistakes can only be saved after the attempt has been submitted.');
    let cands = vaultCandidates(result.review);
    if (questionIds) cands = cands.filter((c) => questionIds.includes(c.item.questionId));
    let added = 0, skipped = 0; const now = this.now();
    for (const c of cands) {
      const r = addToVault(d.vault, this.getUserId(), c, attemptId, now, () => crypto.randomUUID());
      d.vault = r.items; r.added ? added++ : skipped++;
    }
    this.save(d);
    return { added, skipped };
  }

  async selfRateVaultItem(id: string, rating: SelfRating) {
    const d = this.load();
    const item = d.vault.find((v) => v.id === id);
    if (!item) throw new ServiceError('not_found', 'Vault item not found.');
    const updated = selfRate(item, rating, this.now());
    d.vault = d.vault.map((v) => (v.id === id ? updated : v));
    this.save(d);
    return updated;
  }

  // ------------------------------------------------------------ targeted practice
  async getRecommendations() {
    const d = this.load();
    return recommendPractice({ records: d.records, bank: practiceBank.questions, vault: d.vault });
  }

  async createPracticeSession(i: { mode: PracticeSession['mode']; skill?: PracticeSession['skill']; questionIds?: string[]; vaultItemId?: string }) {
    const d = this.load(); const known = new Map(allQuestions().map((q) => [q.id, q]));
    let ids: string[] = []; let skill = i.skill ?? null; let vaultItemId: string | null = null;

    if (i.mode === 'recommended') {
      ids = (i.questionIds ?? []).filter((id) => known.has(id));
      if (ids.length === 0) throw new ServiceError('invalid', 'Choose at least one practice question.');
    } else {
      const item = d.vault.find((v) => v.id === i.vaultItemId);
      if (!item) throw new ServiceError('not_found', 'Vault item not found.');
      vaultItemId = item.id; skill = item.skillTags[0] ?? null;
      if (i.mode === 'vault_retry') ids = [item.questionId];
      else {
        const seen = new Set(d.records.map((r) => r.questionId));
        const pick = pickFreshForVault(item, practiceBank.questions, seen);
        if (!pick) throw new ServiceError('no_fresh_question', 'You have already seen every practice question for this skill — more content is needed.');
        ids = [pick.id];
      }
    }
    const sig = `${i.mode}|${vaultItemId ?? ''}|${ids.join(',')}`;
    const open = d.practice.find((p) => p.status === 'created' && `${p.mode}|${p.vaultItemId ?? ''}|${p.questionIds.join(',')}` === sig);
    if (open) return open;
    const session: PracticeSession = {
      id: crypto.randomUUID(), mode: i.mode, skill, questionIds: ids, vaultItemId, status: 'created',
      createdAt: this.now().toISOString(), completedAt: null, grades: null,
    };
    d.practice.push(session); this.save(d);
    return session;
  }

  async getPracticeSession(id: string): Promise<PracticeContent | null> {
    const d = this.load(); const session = d.practice.find((p) => p.id === id);
    if (!session) return null;
    const qs = allQuestions().filter((q) => session.questionIds.includes(q.id));
    const ordered = session.questionIds.map((id2) => qs.find((q) => q.id === id2)!).filter(Boolean);
    const pids = new Set(ordered.map((q) => q.passageId));
    return { session, questions: ordered, passages: allPassages().filter((p) => pids.has(p.id)) };
  }

  async submitPracticeSession(id: string, answers: Record<string, AnswerValue>): Promise<PracticeSession> {
    const keys = await loadKeys();
    const d = this.load(); const s = d.practice.find((p) => p.id === id);
    if (!s) throw new ServiceError('not_found', 'Practice session not found.');
    if (s.status === 'completed') return s; // idempotent
    const known = new Map(allQuestions().map((q) => [q.id, q]));
    const now = this.now();
    let graded;
    try {
      graded = gradePractice({ session: s, questions: s.questionIds.map((id) => known.get(id)!).filter(Boolean), keys: s.questionIds.map((id) => keys.get(id)!).filter(Boolean), answers, vault: d.vault, now });
    } catch (e) {
      if (e instanceof PracticeError) throw new ServiceError(e.code, e.message);
      throw e;
    }
    const { grades, vaultUpdates, answered } = graded;
    const at = now.toISOString();
    for (const g of grades) d.records.push({ questionId: g.questionId, skillTags: known.get(g.questionId)!.skillTags, correct: g.outcome === 'correct', at, source: s.mode === 'recommended' ? 'practice' : 'vault' });
    d.activity.push({ type: 'practice_completed', at, questions: answered });
    d.vault = d.vault.map((v) => vaultUpdates.find((u) => u.id === v.id) ?? v);
    const done: PracticeSession = { ...s, status: 'completed', completedAt: at, grades };
    d.practice = d.practice.map((p) => (p.id === id ? done : p));
    this.save(d);
    return done;
  }

  async getAnswerRecords() { return this.load().records; }
  async getActivity() { return this.load().activity; }
}
