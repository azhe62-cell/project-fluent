import type { AnswerValue, ReviewItem, SkillTag } from './types';

/**
 * Mistake Vault rules.
 *
 *  - An item is saved once per (user, question, question version) — duplicates are ignored.
 *  - Reading an explanation changes NOTHING. Mastery is earned by successful practice:
 *    MASTERY_STREAK consecutive correct retries, at least one of them on a FRESH related
 *    question (so memorising one answer isn't enough).
 *  - The learner can self-rate "needs more practice" (resets progress) or "understood"
 *    (recorded, but never grants mastery).
 *  - Review intervals are an adjustable rule of thumb, not a guarantee of learning.
 */

export type VaultStatus = 'new' | 'learning' | 'mastered';
export type VaultReason = 'incorrect' | 'partial' | 'unanswered' | 'unsure';
export type SelfRating = 'understood' | 'needs_practice';

export const MASTERY_STREAK = 2;
export const REVIEW_INTERVAL_DAYS = [1, 3, 7] as const;
export const MASTERED_RECHECK_DAYS = 14;

export interface VaultItem {
  id: string;
  userId: string;
  questionId: string;
  questionVersion: number;
  sourceAttemptId: string;
  submitted: AnswerValue;
  reason: VaultReason;
  skillTags: SkillTag[];
  topicTags: string[];
  passageId: string;
  status: VaultStatus;
  correctStreak: number;
  freshCorrect: number;
  reviewCount: number;
  selfRating: SelfRating | null;
  createdAt: string;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
}

export interface VaultCandidate { item: ReviewItem; reason: VaultReason }

/** Incorrect, partial, unanswered, or flagged "unsure" items are eligible. */
export function vaultCandidates(review: ReviewItem[]): VaultCandidate[] {
  const out: VaultCandidate[] = [];
  for (const item of review) {
    if (item.outcome === 'incorrect') out.push({ item, reason: 'incorrect' });
    else if (item.outcome === 'partial') out.push({ item, reason: 'partial' });
    else if (item.outcome === 'unanswered') out.push({ item, reason: 'unanswered' });
    else if (item.unsure) out.push({ item, reason: 'unsure' });
  }
  return out;
}

const DAY = 86_400_000;
const plusDays = (now: Date, d: number) => new Date(now.getTime() + d * DAY).toISOString();

export function addToVault(
  existing: VaultItem[],
  userId: string,
  candidate: VaultCandidate,
  sourceAttemptId: string,
  now: Date,
  newId: () => string,
): { items: VaultItem[]; added: boolean } {
  const c = candidate.item;
  const dup = existing.some((v) => v.userId === userId && v.questionId === c.questionId && v.questionVersion === c.version);
  if (dup) return { items: existing, added: false };
  const item: VaultItem = {
    id: newId(), userId, questionId: c.questionId, questionVersion: c.version, sourceAttemptId,
    submitted: c.submitted, reason: candidate.reason, skillTags: c.skillTags, topicTags: c.topicTags,
    passageId: c.passageId, status: 'new', correctStreak: 0, freshCorrect: 0, reviewCount: 0,
    selfRating: null, createdAt: now.toISOString(), lastReviewedAt: null, nextReviewAt: plusDays(now, REVIEW_INTERVAL_DAYS[0]),
  };
  return { items: [...existing, item], added: true };
}

/** Record the result of a retry. `fresh` = a different question on the same concept. */
export function recordRetry(item: VaultItem, correct: boolean, fresh: boolean, now: Date): VaultItem {
  const base = { ...item, reviewCount: item.reviewCount + 1, lastReviewedAt: now.toISOString() };
  if (!correct) {
    return { ...base, status: 'learning', correctStreak: 0, nextReviewAt: plusDays(now, REVIEW_INTERVAL_DAYS[0]) };
  }
  const correctStreak = item.correctStreak + 1;
  const freshCorrect = item.freshCorrect + (fresh ? 1 : 0);
  if (correctStreak >= MASTERY_STREAK && freshCorrect >= 1) {
    return { ...base, status: 'mastered', correctStreak, freshCorrect, nextReviewAt: plusDays(now, MASTERED_RECHECK_DAYS) };
  }
  const interval = REVIEW_INTERVAL_DAYS[Math.min(correctStreak, REVIEW_INTERVAL_DAYS.length - 1)];
  return { ...base, status: 'learning', correctStreak, freshCorrect, nextReviewAt: plusDays(now, interval) };
}

export function selfRate(item: VaultItem, rating: SelfRating, now: Date): VaultItem {
  if (rating === 'needs_practice') {
    return { ...item, selfRating: rating, status: item.status === 'new' ? 'new' : 'learning', correctStreak: 0, nextReviewAt: plusDays(now, REVIEW_INTERVAL_DAYS[0]) };
  }
  // "Understood" is only a note — it can never promote an item to mastered.
  return { ...item, selfRating: rating };
}

export const isDue = (item: VaultItem, now: Date) =>
  item.status !== 'mastered' && (!item.nextReviewAt || Date.parse(item.nextReviewAt) <= now.getTime());

export interface VaultFilter { skill?: SkillTag; topic?: string; status?: VaultStatus }
export function filterVault(items: VaultItem[], f: VaultFilter): VaultItem[] {
  return items.filter((i) =>
    (!f.skill || i.skillTags.includes(f.skill)) &&
    (!f.topic || i.topicTags.includes(f.topic)) &&
    (!f.status || i.status === f.status));
}
