import type { AnswerValue, PublicQuestion } from './types';

export type Validation = { ok: true } | { ok: false; reason: string };

export const MAX_TEXT_LENGTH = 200;

/**
 * Validates the *shape* of an answer before it is saved or submitted.
 * It does not check correctness. Run server-side on every save; the UI also
 * uses it to give immediate feedback.
 */
export function validateAnswer(question: PublicQuestion, answer: AnswerValue): Validation {
  if (answer === null) return { ok: true };

  switch (question.type) {
    case 'multiple_choice':
    case 'true_false_not_given':
    case 'matching_information': {
      if (typeof answer !== 'string') return { ok: false, reason: 'Expected a single choice.' };
      if (answer === '') return { ok: true };
      return question.options?.some((o) => o.id === answer)
        ? { ok: true }
        : { ok: false, reason: 'That choice is not one of the options.' };
    }
    case 'multi_select': {
      if (!Array.isArray(answer)) return { ok: false, reason: 'Expected a list of choices.' };
      if (new Set(answer).size !== answer.length) return { ok: false, reason: 'Duplicate choices.' };
      if (answer.length > (question.selectCount ?? 1))
        return { ok: false, reason: `Choose no more than ${question.selectCount}.` };
      const valid = new Set(question.options?.map((o) => o.id));
      return answer.every((a) => typeof a === 'string' && valid.has(a))
        ? { ok: true }
        : { ok: false, reason: 'Unknown option selected.' };
    }
    case 'sentence_completion':
    case 'summary_completion':
    case 'short_answer': {
      if (typeof answer !== 'string') return { ok: false, reason: 'Expected text.' };
      if (answer.length > MAX_TEXT_LENGTH) return { ok: false, reason: 'Answer is too long.' };
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(answer)) return { ok: false, reason: 'Invalid characters.' };
      return { ok: true };
    }
  }
}
