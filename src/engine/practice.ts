import type { AnswerKey, AnswerValue, PublicQuestion, QuestionOutcome, SkillTag } from './types';
import { isBlank } from './normalize';
import { describeAnswer } from './review';
import { markQuestion } from './scoring';
import { validateAnswer } from './validate';
import { recordRetry, type VaultItem } from './vault';

/**
 * Targeted-practice rules shared by the local adapter and the server (Edge Function), so both behave
 * identically. Pure: no I/O, no clock (pass `now`).
 */
export interface GradedItem {
  questionId: string; number: number; prompt: string; outcome: QuestionOutcome; awarded: number; max: number;
  submittedDisplay: string; correctDisplay: string; explanation: string; skillTags: SkillTag[];
}

export class PracticeError extends Error {
  constructor(public code: 'empty' | 'invalid', message: string) { super(message); this.name = 'PracticeError'; }
}

export interface GradePracticeInput {
  session: { mode: 'recommended' | 'vault_retry' | 'vault_fresh'; vaultItemId: string | null; questionIds: string[] };
  questions: PublicQuestion[];
  keys: AnswerKey[];
  answers: Record<string, AnswerValue>;
  vault: VaultItem[];
  now: Date;
}

export function gradePractice(i: GradePracticeInput): { grades: GradedItem[]; vaultUpdates: VaultItem[]; answered: number } {
  const qById = new Map(i.questions.map((q) => [q.id, q]));
  const kById = new Map(i.keys.map((k) => [k.questionId, k]));
  if (i.session.questionIds.every((id) => isBlank(i.answers[id] ?? null))) throw new PracticeError('empty', 'Answer at least one question before submitting.');

  const grades: GradedItem[] = i.session.questionIds.map((id) => {
    const q = qById.get(id); const key = kById.get(id);
    if (!q || !key) throw new PracticeError('invalid', 'This session refers to a question that is no longer available.');
    const ans = i.answers[id] ?? null;
    const v = validateAnswer(q, ans);
    if (!v.ok) throw new PracticeError('invalid', v.reason);
    const m = markQuestion(key, ans);
    return { questionId: id, number: q.number, prompt: q.prompt, outcome: m.outcome, awarded: m.awarded, max: m.max,
      submittedDisplay: describeAnswer(q, ans), correctDisplay: key.display, explanation: key.explanation, skillTags: q.skillTags };
  });

  // Vault progress comes only from genuine, graded answers. Reading explanations never moves an item.
  const vaultUpdates: VaultItem[] = [];
  if (i.session.vaultItemId) {
    const item = i.vault.find((v) => v.id === i.session.vaultItemId);
    if (item) vaultUpdates.push(recordRetry(item, grades.every((g) => g.outcome === 'correct'), i.session.mode === 'vault_fresh', i.now));
  } else {
    for (const g of grades) {
      const item = i.vault.find((v) => v.questionId === g.questionId && v.status !== 'mastered');
      if (item) vaultUpdates.push(recordRetry(item, g.outcome === 'correct', false, i.now));
    }
  }
  return { grades, vaultUpdates, answered: grades.filter((g) => g.outcome !== 'unanswered').length };
}

/** Picks one fresh practice-bank question for a vault item: same skill, never seen, closest topic then difficulty 2. */
export function pickFreshForVault(item: Pick<VaultItem, 'questionId' | 'skillTags' | 'topicTags'>, bank: PublicQuestion[], seen: Set<string>): PublicQuestion | undefined {
  const topicHits = (q: PublicQuestion) => q.topicTags.filter((t) => item.topicTags.includes(t)).length;
  return bank
    .filter((q) => !seen.has(q.id) && q.id !== item.questionId && q.skillTags.some((t) => item.skillTags.includes(t)))
    .sort((a, b) => topicHits(b) - topicHits(a) || Math.abs(a.difficulty - 2) - Math.abs(b.difficulty - 2) || a.id.localeCompare(b.id))[0];
}
