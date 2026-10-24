import { describe, expect, it } from 'vitest';
import { recommendPractice, skillStats, type AnswerRecord } from './recommend';
import { practiceBank } from '@/content/practice-bank.public';
import { readingMiniMock01 } from '@/content/reading-mini-mock-01.public';
import { addToVault } from './vault';
import type { ReviewItem } from './types';

const bank = practiceBank.questions;
const mock = new Map(readingMiniMock01.questions.map((q) => [q.id, q]));
const rec = (id: string, correct: boolean, source: AnswerRecord['source'] = 'mock'): AnswerRecord => {
  const q = mock.get(id) ?? bank.find((b) => b.id === id)!;
  return { questionId: id, skillTags: q.skillTags, correct, at: '2026-03-01T00:00:00.000Z', source };
};

describe('recommendPractice', () => {
  const weakTf = [rec('rd01-q03', true), rec('rd01-q04', false), rec('rd01-q05', false), rec('rd01-q11', false), rec('rd01-q12', true)];

  it('returns nothing without data, or with too little data per skill', () => {
    expect(recommendPractice({ records: [], bank, vault: [] })).toEqual([]);
    expect(recommendPractice({ records: [rec('rd01-q04', false)], bank, vault: [] })).toEqual([]);
  });

  it('targets the weakest skill and explains why with real counts', () => {
    const out = recommendPractice({ records: weakTf, bank, vault: [] });
    const top = out.find((r) => r.skill === 'identifying_writer_claims')!;
    expect(top).toBeDefined();
    expect(top.sampleSize).toBe(5);
    expect(top.reason).toMatch(/3 of 5/);
    expect(top.reason).toMatch(/small sample/i);
    expect(top.questionIds.length).toBeGreaterThan(0);
  });

  it('serves only questions that match the skill and come from the bank', () => {
    for (const r of recommendPractice({ records: weakTf, bank, vault: [] }))
      for (const id of r.questionIds) expect(bank.find((b) => b.id === id)!.skillTags).toContain(r.skill);
  });

  it('prefers FRESH questions and never repeats an item the learner has already answered correctly twice', () => {
    const records = [...weakTf, rec('pb-q01', true, 'practice'), rec('pb-q01', true, 'practice'), rec('pb-q11', true, 'practice')];
    const top = recommendPractice({ records, bank, vault: [] }).find((r) => r.skill === 'identifying_writer_claims')!;
    expect(top.questionIds).not.toContain('pb-q01');
    expect(top.freshCount).toBeGreaterThan(0);
  });

  it('includes a previously missed question for revisiting, and says so in the counts', () => {
    const records = [...weakTf, rec('pb-q02', false, 'practice')];
    const top = recommendPractice({ records, bank, vault: [] }).find((r) => r.skill === 'identifying_writer_claims')!;
    expect(top.questionIds).toContain('pb-q02');
    expect(top.revisitCount).toBeGreaterThanOrEqual(1);
    expect(top.freshCount + top.revisitCount).toBe(top.questionIds.length);
  });

  it('eases the target difficulty when accuracy is low', () => {
    const low = [rec('rd01-q04', false), rec('rd01-q05', false), rec('rd01-q11', false), rec('rd01-q03', true)];
    const mid = [rec('rd01-q04', false), rec('rd01-q05', true), rec('rd01-q11', true), rec('rd01-q03', true)];
    const f = (records: AnswerRecord[]) => recommendPractice({ records, bank, vault: [] }).find((r) => r.skill === 'identifying_writer_claims')!;
    expect(f(low).targetDifficulty).toBe(1);
    expect(f(mid).targetDifficulty).toBe(3);
  });

  it('does not recommend strong skills', () => {
    const strong = [rec('rd01-q03', true), rec('rd01-q04', true), rec('rd01-q05', true), rec('rd01-q11', true)];
    expect(recommendPractice({ records: strong, bank, vault: [] })).toEqual([]);
  });

  it('never lists the same question under two skills, and is deterministic', () => {
    const records = [...weakTf, rec('rd01-q06', false), rec('rd01-q07', false), rec('rd01-q08', true)];
    const a = recommendPractice({ records, bank, vault: [], maxSkills: 3 });
    const b = recommendPractice({ records, bank, vault: [], maxSkills: 3 });
    expect(a).toEqual(b);
    const all = a.flatMap((r) => r.questionIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('skillStats aggregates every tag on each answer', () => {
    const s = skillStats([rec('rd01-q02', true), rec('rd01-q02', false)]);
    expect(s.get('locating_detail')).toEqual({ correct: 1, total: 2 });
    expect(s.get('paraphrase_recognition')).toEqual({ correct: 1, total: 2 });
  });

  it('uses vault entries to decide what to revisit', () => {
    const item: ReviewItem = { questionId: 'pb-q06', version: 1, number: 0, prompt: '', type: 'true_false_not_given', submitted: 'FALSE', submittedDisplay: '', correctDisplay: '', outcome: 'incorrect', awarded: 0, max: 1, explanation: '', unsure: false, skillTags: ['identifying_writer_claims', 'paraphrase_recognition'], topicTags: [], passageId: 'pb-bakery' };
    const vault = addToVault([], 'u1', { item, reason: 'incorrect' }, 'att', new Date('2026-03-01'), () => 'v1').items;
    const out = recommendPractice({ records: [...weakTf, rec('pb-q06', false, 'practice')], bank, vault });
    expect(out.flatMap((r) => r.questionIds)).toContain('pb-q06');
  });
});
