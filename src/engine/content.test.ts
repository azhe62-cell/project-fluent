import { describe, expect, it } from 'vitest';
import { publishedTests, practiceBank } from '@/content/index.public';
import { allAnswerKeys } from '@/content/index.keys';
import { normaliseText, countWords } from './normalize';
import { validateAnswer } from './validate';
import type { PublicQuestion } from './types';

const mock = publishedTests[0];
const everyQuestion = [...mock.questions, ...practiceBank.questions];

describe('content integrity', () => {
  it('question ids are unique across mock and practice bank', () => {
    const ids = everyQuestion.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every question has exactly one answer key with matching version and marks', () => {
    const keys = new Map(allAnswerKeys.map((k) => [k.questionId, k]));
    expect(keys.size).toBe(allAnswerKeys.length);
    for (const q of everyQuestion) {
      const k = keys.get(q.id);
      expect(k, q.id).toBeDefined();
      expect(k!.version, q.id).toBe(q.version);
      expect(k!.marks, q.id).toBe(q.marks);
    }
    expect(allAnswerKeys.length).toBe(everyQuestion.length); // no orphan keys
  });
  it('mock questions are numbered 1..19 in order and total 20 marks', () => {
    expect(mock.questions.map((q) => q.number)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(mock.questions.reduce((a, q) => a + q.marks, 0)).toBe(20);
  });
  it('every mock question appears in exactly one group', () => {
    const grouped = mock.sections.flatMap((s) => s.groups.flatMap((g) => g.questionIds));
    expect([...grouped].sort()).toEqual(mock.questions.map((q) => q.id).sort());
  });
  it('every question references an existing passage', () => {
    const passages = new Set([...mock.passages, ...practiceBank.passages].map((p) => p.id));
    for (const q of everyQuestion) expect(passages.has(q.passageId), q.id).toBe(true);
  });
  it('keys reference real options and accepted text fits its own word limit', () => {
    const byId = new Map(everyQuestion.map((q) => [q.id, q]));
    for (const k of allAnswerKeys) {
      const q = byId.get(k.questionId)!;
      const optionIds = new Set(q.options?.map((o) => o.id));
      if (k.rule.kind === 'single') expect(optionIds.has(k.rule.correct), k.questionId).toBe(true);
      if (k.rule.kind === 'multi') {
        for (const c of k.rule.correct) expect(optionIds.has(c), k.questionId).toBe(true);
        expect(k.rule.correct.length).toBe(q.selectCount);
      }
      if (k.rule.kind === 'text') {
        expect(q.wordLimit, k.questionId).toBe(k.rule.maxWords);
        for (const a of k.rule.accepted) expect(countWords(normaliseText(a, true)), `${k.questionId}:${a}`).toBeLessThanOrEqual(k.rule.maxWords);
      }
      expect(k.explanation.length, k.questionId).toBeGreaterThan(30);
    }
  });
  it('completion answers actually appear in their passage text (so they are findable)', () => {
    const passages = new Map([...mock.passages, ...practiceBank.passages].map((p) => [p.id, p.paragraphs.map((x) => x.text).join(' ').toLowerCase()]));
    const byId = new Map(everyQuestion.map((q) => [q.id, q]));
    for (const k of allAnswerKeys) {
      if (k.rule.kind !== 'text') continue;
      const text = passages.get(byId.get(k.questionId)!.passageId)!;
      expect(k.rule.accepted.some((a) => text.includes(a.toLowerCase())), k.questionId).toBe(true);
    }
  });
  it('the mock covers each required question format', () => {
    const types = new Set(mock.questions.map((q) => q.type));
    for (const t of ['multiple_choice', 'multi_select', 'true_false_not_given', 'matching_information', 'sentence_completion', 'summary_completion', 'short_answer'])
      expect(types.has(t as PublicQuestion['type']), t).toBe(true);
    expect(mock.passages).toHaveLength(2);
  });
  it('PUBLIC content contains no answer data', () => {
    const json = JSON.stringify({ mock, practiceBank });
    for (const banned of ['"correct"', '"accepted"', '"explanation"', '"rule"', '"display"']) expect(json).not.toContain(banned);
  });
  it('every practice-bank question is shape-valid for its own options', () => {
    for (const q of everyQuestion) expect(validateAnswer(q, null).ok).toBe(true);
  });
});

describe('validateAnswer', () => {
  const get = (id: string) => everyQuestion.find((q) => q.id === id)!;
  it('rejects unknown option ids and wrong shapes', () => {
    expect(validateAnswer(get('rd01-q01'), 'Z').ok).toBe(false);
    expect(validateAnswer(get('rd01-q01'), ['A']).ok).toBe(false);
    expect(validateAnswer(get('rd01-q09'), 'A').ok).toBe(false);
    expect(validateAnswer(get('rd01-q09'), ['A', 'B', 'C']).ok).toBe(false);
    expect(validateAnswer(get('rd01-q09'), ['A', 'A']).ok).toBe(false);
    expect(validateAnswer(get('rd01-q09'), ['A', 'Z']).ok).toBe(false);
    expect(validateAnswer(get('rd01-q06'), ['x']).ok).toBe(false);
  });
  it('accepts valid answers and rejects oversize or control-character text', () => {
    expect(validateAnswer(get('rd01-q01'), 'B').ok).toBe(true);
    expect(validateAnswer(get('rd01-q09'), ['A', 'C']).ok).toBe(true);
    expect(validateAnswer(get('rd01-q06'), 'common').ok).toBe(true);
    expect(validateAnswer(get('rd01-q06'), 'x'.repeat(201)).ok).toBe(false);
    expect(validateAnswer(get('rd01-q06'), 'bad\u0000').ok).toBe(false);
  });
});
