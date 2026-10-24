/**
 * Core domain types.
 *
 * SECURITY BOUNDARY
 *  - `PublicQuestion`, `Passage`, `PublicTest` are safe to send to the browser.
 *  - `AnswerKey` (marking rules + explanations) lives server-side. The browser only
 *    receives answers/explanations AFTER an attempt is finalised (see `ResultView`).
 */

export type QuestionType =
  | 'multiple_choice'
  | 'multi_select'
  | 'true_false_not_given'
  | 'matching_information'
  | 'sentence_completion'
  | 'summary_completion'
  | 'short_answer';

export type SkillTag =
  | 'locating_detail'
  | 'inference'
  | 'identifying_writer_claims'
  | 'scanning_paragraphs'
  | 'paraphrase_recognition'
  | 'vocabulary_precision';

export interface Option { id: string; label: string }

export interface PublicQuestion {
  /** Stable ID, never reused. */
  id: string;
  /** Bumped whenever prompt/options/marking change in a way that affects results. */
  version: number;
  /** Display number within the test (1-based). Practice-bank items use 0. */
  number: number;
  type: QuestionType;
  passageId: string;
  prompt: string;
  instructions?: string;
  options?: Option[];
  /** multi_select: how many options must be chosen. */
  selectCount?: number;
  /** Text answers: maximum words allowed. */
  wordLimit?: number;
  marks: number;
  skillTags: SkillTag[];
  topicTags: string[];
  /** Editorial estimate only (not psychometrically validated). 1 easiest – 3 hardest. */
  difficulty: 1 | 2 | 3;
}

export interface Paragraph { label?: string; text: string }
export interface Passage {
  id: string;
  title: string;
  kicker?: string;
  paragraphs: Paragraph[];
}

export interface QuestionGroup {
  id: string;
  heading: string;
  instructions: string;
  questionIds: string[];
  /** Options shared by several questions (e.g. paragraph letters). */
  sharedOptions?: Option[];
  /** 'summary' renders the group's questions together as one summary box. */
  variant?: 'summary';
}

export interface PublicSection {
  id: string;
  title: string;
  passageId: string;
  groups: QuestionGroup[];
}

export interface PublicTest {
  id: string;
  slug: string;
  title: string;
  description: string;
  assessmentType: 'reading' | 'listening' | 'writing' | 'speaking';
  version: number;
  durationSeconds: number;
  sections: PublicSection[];
  passages: Passage[];
  questions: PublicQuestion[];
  scoringNote: string;
}

// ---------------------------------------------------------------- answers

/** Stored in `responses.answer`. null = unanswered. */
export type AnswerValue = string | string[] | null;

export interface ResponseDraft {
  questionId: string;
  answer: AnswerValue;
  flagged: boolean;
  /** Learner marked "unsure" — eligible for the Mistake Vault even when correct. */
  unsure: boolean;
  /** Monotonic client sequence number; the server keeps only the highest. */
  seq: number;
}

// ---------------------------------------------------------------- marking (SERVER ONLY)

export type MarkingRule =
  | { kind: 'single'; correct: string }
  | { kind: 'multi'; correct: string[]; partial: boolean }
  | {
      kind: 'text';
      accepted: string[];
      maxWords: number;
      /** Strip leading/trailing punctuation before comparing. Never fuzzy. */
      ignorePunctuation: boolean;
    };

export interface AnswerKey {
  questionId: string;
  version: number;
  marks: number;
  rule: MarkingRule;
  /** Human-readable correct answer for the results report. */
  display: string;
  explanation: string;
}

// ---------------------------------------------------------------- attempts

export type AttemptStatus = 'created' | 'in_progress' | 'submitted' | 'expired' | 'scored';
export type SubmissionKind = 'learner_submitted' | 'time_expired';

export interface Attempt {
  id: string;
  userId: string;
  testId: string;
  testVersion: number;
  status: AttemptStatus;
  createdAt: string;
  startedAt: string | null;
  deadlineAt: string | null;
  submittedAt: string | null;
  submissionKind: SubmissionKind | null;
}

// ---------------------------------------------------------------- scoring

export type QuestionOutcome = 'correct' | 'incorrect' | 'partial' | 'unanswered';

export interface QuestionScore {
  questionId: string;
  version: number;
  outcome: QuestionOutcome;
  awarded: number;
  max: number;
}

export interface SectionScore { sectionId: string; title: string; awarded: number; max: number }
export interface SkillScore { skill: SkillTag; awarded: number; max: number; questions: number }

export interface ScoreResult {
  rawScore: number;
  maxScore: number;
  counts: { correct: number; incorrect: number; partial: number; unanswered: number };
  questionScores: QuestionScore[];
  sectionScores: SectionScore[];
  skillScores: SkillScore[];
  scoringVersion: string;
  scoredAt: string;
}

/** Revealed to the learner only after the attempt is finalised. */
export interface ReviewItem {
  questionId: string;
  version: number;
  number: number;
  prompt: string;
  type: QuestionType;
  submitted: AnswerValue;
  submittedDisplay: string;
  correctDisplay: string;
  outcome: QuestionOutcome;
  awarded: number;
  max: number;
  explanation: string;
  unsure: boolean;
  skillTags: SkillTag[];
  topicTags: string[];
  passageId: string;
}

export interface ResultView {
  attemptId: string;
  testId: string;
  testTitle: string;
  testVersion: number;
  submissionKind: SubmissionKind;
  submittedAt: string;
  timeUsedSeconds: number;
  score: ScoreResult;
  review: ReviewItem[];
  scoringNote: string;
}
