import type {
  AnswerValue, Attempt, Passage, PublicQuestion, PublicTest, ResponseDraft, ResultView,
  SkillTag, SubmissionKind, QuestionOutcome,
} from '@/engine';
import type { Recommendation, AnswerRecord } from '@/engine/recommend';
import type { VaultItem, SelfRating } from '@/engine/vault';
import type { ActivityEvent } from '@/engine/streak';

/**
 * Service boundary. UI code talks ONLY to these interfaces, so the backend can be swapped
 * (local development adapter ⇄ Supabase ⇄ any equivalent platform) without touching pages.
 */
export type ServiceMode = 'local' | 'supabase';

export class ServiceError extends Error {
  constructor(public code:
    | 'not_found' | 'forbidden' | 'invalid' | 'conflict' | 'unauthenticated'
    | 'not_implemented' | 'no_fresh_question' | 'empty' | 'auth' | 'network' | 'rate_limited',
    message: string) { super(message); this.name = 'ServiceError'; }
}

// ------------------------------------------------------------------ auth
export interface AuthUser { id: string; email: string; displayName: string }

export interface AuthService {
  mode: ServiceMode;
  getUser(): Promise<AuthUser | null>;
  subscribe(cb: (u: AuthUser | null) => void): () => void;
  signUp(i: { email: string; password?: string; displayName: string }): Promise<{ user: AuthUser | null; needsEmailVerification: boolean }>;
  signIn(i: { email: string; password?: string }): Promise<AuthUser>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /** Sets a new password for the signed-in user (used after following a password-reset link). */
  updatePassword(password: string): Promise<void>;
  updateDisplayName(name: string): Promise<AuthUser>;
  /** Deletes the account and all associated learner data. */
  deleteAccount(): Promise<void>;
}

// ------------------------------------------------------------------ assessment
export interface TestSummary {
  id: string; slug: string; title: string; description: string;
  assessmentType: PublicTest['assessmentType']; durationSeconds: number;
  questionCount: number; totalMarks: number; version: number; passageCount: number;
}

export interface AttemptSession {
  attempt: Attempt;
  test: PublicTest;
  responses: Record<string, ResponseDraft>;
  /** Server clock at response time — the client derives its offset from this. */
  serverNow: string;
}

export interface SaveResult {
  serverNow: string;
  applied: number;
  stale: number;
  rejected: { questionId: string; reason: string }[];
  fatal?: 'deadline_passed' | 'not_in_progress' | 'forbidden';
}

export interface PracticeGrade {
  questionId: string; number: number; prompt: string; outcome: QuestionOutcome; awarded: number; max: number;
  submittedDisplay: string; correctDisplay: string; explanation: string; skillTags?: SkillTag[];
}

export type PracticeMode = 'recommended' | 'vault_retry' | 'vault_fresh';
export interface PracticeSession {
  id: string; mode: PracticeMode; skill: SkillTag | null; questionIds: string[]; vaultItemId: string | null;
  status: 'created' | 'completed'; createdAt: string; completedAt: string | null; grades: PracticeGrade[] | null;
}
export interface PracticeContent { session: PracticeSession; questions: PublicQuestion[]; passages: Passage[] }

export interface Capabilities { assessments: boolean; vault: boolean; practice: boolean }

export interface AssessmentService {
  mode: ServiceMode;
  capabilities: Capabilities;

  listTests(): Promise<TestSummary[]>;
  getTest(slug: string): Promise<PublicTest | null>;

  /** Resumes the learner's open attempt for this test if one exists; otherwise creates one. */
  startOrResumeAttempt(testId: string): Promise<AttemptSession>;
  getAttempt(attemptId: string): Promise<AttemptSession | null>;
  saveResponses(attemptId: string, drafts: ResponseDraft[]): Promise<SaveResult>;
  /** Idempotent. Never claims success until the server has stored the result. */
  submitAttempt(attemptId: string, kind: SubmissionKind): Promise<ResultView>;
  getResult(attemptId: string): Promise<ResultView | null>;
  listResults(): Promise<ResultView[]>;
  listAttempts(): Promise<Attempt[]>;

  listVault(): Promise<VaultItem[]>;
  addToVault(attemptId: string, questionIds?: string[]): Promise<{ added: number; skipped: number }>;
  selfRateVaultItem(id: string, rating: SelfRating): Promise<VaultItem>;

  getRecommendations(): Promise<Recommendation[]>;
  createPracticeSession(i: { mode: PracticeMode; skill?: SkillTag; questionIds?: string[]; vaultItemId?: string }): Promise<PracticeSession>;
  getPracticeSession(id: string): Promise<PracticeContent | null>;
  submitPracticeSession(id: string, answers: Record<string, AnswerValue>): Promise<PracticeSession>;

  getAnswerRecords(): Promise<AnswerRecord[]>;
  getActivity(): Promise<ActivityEvent[]>;
}

export interface Services { mode: ServiceMode; auth: AuthService; assessments: AssessmentService }
