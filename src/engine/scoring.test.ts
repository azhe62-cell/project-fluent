import { describe, expect, it } from 'vitest';
import { markQuestion, scoreAttempt, SCORING_VERSION } from './scoring';
import { normaliseText, countWords } from './normalize';
import type { AnswerKey, AnswerValue } from './types';
import { readingMiniMock01 as test } from '@/content/reading-mini-mock-01.public';
import { readingMiniMock01Keys as keys } from '@/content/reading-mini-mock-01.keys';

const single = (correct: string): AnswerKey => ({ questionId: 'x', version: 1, marks: 1, rule: { kind: 'single', correct }, display: correct, explanation: '' });
const multi = (correct: string[], partial: boolean, marks = 2): AnswerKey => ({ questionId: 'x', version: 1, marks, rule: { kind: 'multi', correct, partial }, display: '', explanation: '' });
const text = (accepted: string[], maxWords = 1): AnswerKey => ({ questionId: 'x', version: 1, marks: 1, rule: { kind: 'text', accepted, maxWords, ignorePunctuation: true }, display: '', explanation: '' });

describe('normaliseText', () => {
  it('trims, collapses whitespace and lower-cases', () => expect(normaliseText('  A   Smaller\tWALL ', false)).toBe('a smaller wall'));
  it('strips leading/trailing punctuation only when asked', () => {
    expect(normaliseText('Half.', true)).toBe('half');
    expect(normaliseText('"half"', true)).toBe('half');
    expect(normaliseText('Half.', false)).toBe('half.');
  });
  it('keeps internal punctuation (hyphen is not a space)', () => expect(normaliseText('well-known', true)).toBe('well-known'));
  it('counts hyphenated compounds as one word', () => {
    expect(countWords('well-known')).toBe(1);
    expect(countWords('a smaller wall')).toBe(3);
    expect(countWords('')).toBe(0);
  });
});

describe('markQuestion — single', () => {
  it('correct / incorrect / unanswered', () => {
    expect(markQuestion(single('B'), 'B').outcome).toBe('correct');
    expect(markQuestion(single('B'), 'C').outcome).toBe('incorrect');
    expect(markQuestion(single('B'), null).outcome).toBe('unanswered');
    expect(markQuestion(single('B'), '').outcome).toBe('unanswered');
  });
  it('is exact: lower-case id is NOT accepted, an array is rejected', () => {
    expect(markQuestion(single('B'), 'b').outcome).toBe('incorrect');
    expect(markQuestion(single('B'), ['B']).outcome).toBe('incorrect');
  });
  it('True/False/Not Given distinguishes all three', () => {
    for (const [given, want] of [['TRUE', 'TRUE'], ['FALSE', 'TRUE'], ['NOT_GIVEN', 'TRUE']] as const) {
      expect(markQuestion(single(want), given).outcome).toBe(given === want ? 'correct' : 'incorrect');
    }
  });
});

describe('markQuestion — multi', () => {
  it('both correct = full marks, order irrelevant', () => {
    expect(markQuestion(multi(['A', 'C'], true), ['C', 'A'])).toMatchObject({ outcome: 'correct', awarded: 2 });
  });
  it('partial rule: one right + one wrong = 1 mark; no negative marking', () => {
    expect(markQuestion(multi(['A', 'C'], true), ['A', 'B'])).toMatchObject({ outcome: 'partial', awarded: 1 });
  });
  it('partial rule: a single correct choice = 1 mark', () => {
    expect(markQuestion(multi(['A', 'C'], true), ['C'])).toMatchObject({ outcome: 'partial', awarded: 1 });
  });
  it('two wrong = 0', () => expect(markQuestion(multi(['A', 'C'], true), ['B', 'D'])).toMatchObject({ outcome: 'incorrect', awarded: 0 }));
  it('too many choices scores zero even if the right ones are included', () => {
    expect(markQuestion(multi(['A', 'C'], true), ['A', 'C', 'D'])).toMatchObject({ outcome: 'incorrect', awarded: 0 });
  });
  it('duplicate selections cannot be used to game the marks', () => {
    expect(markQuestion(multi(['A', 'C'], true), ['A', 'A'])).toMatchObject({ awarded: 1 });
  });
  it('all-or-nothing when partial is disabled', () => {
    expect(markQuestion(multi(['A', 'C'], false), ['A'])).toMatchObject({ outcome: 'incorrect', awarded: 0 });
    expect(markQuestion(multi(['A', 'C'], false), ['A', 'C'])).toMatchObject({ outcome: 'correct', awarded: 2 });
  });
  it('empty list is unanswered', () => expect(markQuestion(multi(['A', 'C'], true), []).outcome).toBe('unanswered'));
});

describe('markQuestion — text', () => {
  const k = text(['a smaller wall', 'smaller wall'], 3);
  it('accepts explicitly listed variants regardless of case/spacing/trailing punctuation', () => {
    for (const a of ['a smaller wall', 'Smaller Wall', '  A  smaller   wall. ']) expect(markQuestion(k, a).outcome).toBe('correct');
  });
  it('rejects unlisted answers — no fuzzy matching, no plural/stem leniency', () => {
    expect(markQuestion(text(['brushes', 'brush']), 'brusches').outcome).toBe('incorrect'); // typo
    expect(markQuestion(text(['sediment']), 'sediments').outcome).toBe('incorrect');
    expect(markQuestion(text(['volunteers']), 'volunteer').outcome).toBe('incorrect');
  });
  it('rejects answers over the word limit even if they contain the right words', () => {
    expect(markQuestion(k, 'a smaller sea wall').outcome).toBe('incorrect');
    expect(markQuestion(text(['half']), 'more than half').outcome).toBe('incorrect');
  });
  it('whitespace/punctuation-only is unanswered', () => {
    expect(markQuestion(text(['half']), '   ').outcome).toBe('unanswered');
    expect(markQuestion(text(['half']), ' . ').outcome).toBe('unanswered');
  });
  it('hyphenated is not equal to spaced', () => expect(markQuestion(text(['well-known']), 'well known').outcome).toBe('incorrect'));
});

const correctAnswers = (): Record<string, AnswerValue> =>
  Object.fromEntries(keys.map((k) => [k.questionId, k.rule.kind === 'text' ? k.rule.accepted[0] : k.rule.kind === 'multi' ? k.rule.correct : k.rule.correct]));
const score = (responses: Record<string, AnswerValue>) =>
  scoreAttempt({ questions: test.questions, sections: test.sections, keys, responses, scoredAt: '2026-01-01T00:00:00.000Z' });

describe('scoreAttempt — mini-mock 1', () => {
  it('all correct = 20/20 with no incorrect or unanswered', () => {
    const r = score(correctAnswers());
    expect(r.rawScore).toBe(20);
    expect(r.maxScore).toBe(20);
    expect(r.counts).toEqual({ correct: 19, incorrect: 0, partial: 0, unanswered: 0 });
    expect(r.scoringVersion).toBe(SCORING_VERSION);
  });
  it('no responses = 0/20 and 19 unanswered', () => {
    const r = score({});
    expect(r.rawScore).toBe(0);
    expect(r.counts.unanswered).toBe(19);
  });
  it('section totals add up to the overall total', () => {
    const r = score({ ...correctAnswers(), 'rd01-q03': 'FALSE', 'rd01-q16': 'most', 'rd01-q09': ['A', 'B'] });
    expect(r.sectionScores.map((s) => s.max)).toEqual([10, 10]);
    expect(r.sectionScores.reduce((a, s) => a + s.awarded, 0)).toBe(r.rawScore);
    // lost: q03 (1) + q16 (1) + one half of q09 (1) = 3
    expect(r.rawScore).toBe(17);
    expect(r.counts).toEqual({ correct: 16, incorrect: 2, partial: 1, unanswered: 0 });
  });
  it('mixed correct / wrong / blank is counted exactly', () => {
    const r = score({ 'rd01-q01': 'B', 'rd01-q02': 'A', 'rd01-q06': 'common', 'rd01-q11': 'FALSE' });
    expect(r.rawScore).toBe(3);
    expect(r.counts).toEqual({ correct: 3, incorrect: 1, partial: 0, unanswered: 15 });
  });
  it('skill breakdown covers every tagged skill and never exceeds the max', () => {
    const r = score(correctAnswers());
    for (const s of r.skillScores) expect(s.awarded).toBe(s.max);
    expect(r.skillScores.map((s) => s.skill)).toContain('identifying_writer_claims');
  });
  it('throws (never silently scores 0) when an answer key is missing or mismatched', () => {
    expect(() => scoreAttempt({ questions: test.questions, sections: test.sections, keys: keys.slice(1), responses: {}, scoredAt: 'x' })).toThrow(/Missing answer key/);
    const bumped = keys.map((k, i) => (i === 0 ? { ...k, version: 2 } : k));
    expect(() => scoreAttempt({ questions: test.questions, sections: test.sections, keys: bumped, responses: {}, scoredAt: 'x' })).toThrow(/version mismatch/);
  });
  it('records the scoring time given (not the clock)', () => expect(score({}).scoredAt).toBe('2026-01-01T00:00:00.000Z'));
});
