import type { AnswerKey, PublicQuestion, PublicTest, ResultView } from '@/engine';
import type { VaultItem } from '@/engine/vault';

export class NotFoundError extends Error { constructor() { super('not_found'); } }
export class RateLimitedError extends Error { constructor() { super('rate_limited'); } }

export interface FinalizedAttempt {
  id: string; status: 'submitted' | 'expired' | 'scored'; submission_kind: 'learner_submitted' | 'time_expired';
  submitted_at: string; time_used_seconds: number | null; test_version_id: string; result_view: ResultView | null;
}
export interface ScoringInputs {
  versionNumber: number; content: PublicTest; keys: AnswerKey[];
  responses: { questionId: string; answer: unknown; unsure: boolean }[];
}
export interface PracticeSessionRow {
  id: string; mode: 'recommended' | 'vault_retry' | 'vault_fresh'; skill: string | null; questionIds: string[];
  vaultItemId: string | null; status: 'created' | 'completed'; createdAt: string; completedAt: string | null; grades: unknown[] | null;
}

/**
 * Everything the trusted handlers need from the database. Implementations:
 *   - supabaseDb (src/server/supabaseDb.ts): used by the Edge Functions with the SERVICE-ROLE client
 *   - the same class pointed at PGlite in src/db-tests (real PostgreSQL, no HTTP)
 */
export interface ServerDb {
  rateLimit(userId: string, bucket: string, max: number, windowSeconds: number): Promise<void>;
  finalizeAttempt(attemptId: string, userId: string, kind: string): Promise<FinalizedAttempt>;
  getScoringInputs(attemptId: string): Promise<ScoringInputs | null>;
  storeResult(attemptId: string, result: ResultView, answered: number): Promise<ResultView>;
  getPracticeForGrading(sessionId: string, userId: string): Promise<{ session: PracticeSessionRow; questions: PublicQuestion[]; vault: VaultItem[] } | null>;
  getAnswerKeys(questionIds: string[]): Promise<AnswerKey[]>;
  storePracticeResult(sessionId: string, userId: string, grades: unknown[], vaultUpdates: VaultItem[], answered: number): Promise<PracticeSessionRow>;
}
