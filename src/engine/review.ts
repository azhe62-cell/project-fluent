import type { AnswerKey, AnswerValue, PublicQuestion, ReviewItem, ScoreResult } from './types';
import { isBlank } from './normalize';

/** Human-readable form of a submitted answer, using option labels where relevant. */
export function describeAnswer(q: PublicQuestion, answer: AnswerValue): string {
  if (isBlank(answer)) return '— no answer —';
  const optLabel = (id: string) => q.options?.find((o) => o.id === id)?.label;
  switch (q.type) {
    case 'true_false_not_given':
    case 'matching_information':
      return optLabel(answer as string) ?? String(answer);
    case 'multiple_choice': {
      const id = answer as string;
      return optLabel(id) ? `${id} — ${optLabel(id)}` : id;
    }
    case 'multi_select':
      return [...(answer as string[])].sort().map((id) => `${id} — ${optLabel(id) ?? id}`).join('; ');
    default:
      return String(answer).trim();
  }
}

export interface BuildReviewInput {
  questions: PublicQuestion[];
  keys: Map<string, AnswerKey>;
  responses: Record<string, AnswerValue>;
  unsure: Record<string, boolean>;
  score: ScoreResult;
}

/** Combine questions + keys + responses + scores into the post-submission review. */
export function buildReview(i: BuildReviewInput): ReviewItem[] {
  const scores = new Map(i.score.questionScores.map((s) => [s.questionId, s]));
  return i.questions.map((q) => {
    const key = i.keys.get(q.id)!;
    const s = scores.get(q.id)!;
    const submitted = i.responses[q.id] ?? null;
    return {
      questionId: q.id, version: q.version, number: q.number, prompt: q.prompt, type: q.type,
      submitted, submittedDisplay: describeAnswer(q, submitted), correctDisplay: key.display,
      outcome: s.outcome, awarded: s.awarded, max: s.max, explanation: key.explanation,
      unsure: !!i.unsure[q.id], skillTags: q.skillTags, topicTags: q.topicTags, passageId: q.passageId,
    };
  });
}
