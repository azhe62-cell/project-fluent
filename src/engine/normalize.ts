import type { AnswerValue } from './types';

/**
 * Text normalisation for completion-type answers.
 *
 * Deliberately conservative — NOT fuzzy matching:
 *  - Unicode NFKC, trim, collapse internal whitespace, lower-case (IELTS-style
 *    answers are not case sensitive).
 *  - Optionally strip punctuation/symbols at the very start and end only
 *    ("Half." → "half"). Internal punctuation is preserved, so "well-known"
 *    stays one word and never equals "well known".
 *  - No stemming, no spell-correction: "brush" ≠ "brushes" unless both are
 *    listed explicitly in the accepted variants.
 */
export function normaliseText(raw: string, ignorePunctuation: boolean): string {
  let s = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (ignorePunctuation) s = s.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
  return s;
}

/** Words are whitespace-separated tokens; hyphenated compounds count as one word. */
export function countWords(normalised: string): number {
  return normalised === '' ? 0 : normalised.split(' ').length;
}

export function isBlank(answer: AnswerValue): boolean {
  if (answer === null || answer === undefined) return true;
  if (Array.isArray(answer)) return answer.length === 0;
  return answer.trim() === '';
}

/** Readable form of a submitted answer for the results report. */
export function displayAnswer(answer: AnswerValue): string {
  if (isBlank(answer)) return '— no answer —';
  return Array.isArray(answer) ? [...answer].sort().join(' and ') : String(answer).trim();
}
