import { describe, expect, it } from 'vitest';
import { addToVault, filterVault, isDue, MASTERY_STREAK, recordRetry, selfRate, vaultCandidates, type VaultItem } from './vault';
import type { ReviewItem } from './types';

const NOW = new Date('2026-03-01T09:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
let n = 0;
const id = () => `v${++n}`;

const review = (over: Partial<ReviewItem>): ReviewItem => ({
  questionId: 'rd01-q04', version: 1, number: 4, prompt: 'p', type: 'true_false_not_given', submitted: 'TRUE', submittedDisplay: 'TRUE',
  correctDisplay: 'False', outcome: 'incorrect', awarded: 0, max: 1, explanation: 'e', unsure: false,
  skillTags: ['identifying_writer_claims'], topicTags: ['urban-ecology'], passageId: 'p-roofs', ...over,
});

describe('vault candidates', () => {
  it('includes incorrect, partial, unanswered and unsure-but-correct; excludes confident correct', () => {
    const items = [
      review({ questionId: 'a', outcome: 'incorrect' }), review({ questionId: 'b', outcome: 'partial' }),
      review({ questionId: 'c', outcome: 'unanswered' }), review({ questionId: 'd', outcome: 'correct', unsure: true }),
      review({ questionId: 'e', outcome: 'correct' }),
    ];
    expect(vaultCandidates(items).map((c) => [c.item.questionId, c.reason])).toEqual([
      ['a', 'incorrect'], ['b', 'partial'], ['c', 'unanswered'], ['d', 'unsure'],
    ]);
  });
});

describe('addToVault', () => {
  const cand = { item: review({}), reason: 'incorrect' as const };
  it('adds once; the same user/question/version is never duplicated', () => {
    const a = addToVault([], 'u1', cand, 'att1', NOW, id);
    expect(a.added).toBe(true);
    expect(a.items[0]).toMatchObject({ status: 'new', reviewCount: 0, correctStreak: 0, userId: 'u1' });
    const b = addToVault(a.items, 'u1', cand, 'att2', NOW, id);
    expect(b.added).toBe(false);
    expect(b.items).toHaveLength(1);
  });
  it('a different user, or a new question version, is a separate entry', () => {
    const a = addToVault([], 'u1', cand, 'att1', NOW, id).items;
    expect(addToVault(a, 'u2', cand, 'att1', NOW, id).items).toHaveLength(2);
    expect(addToVault(a, 'u1', { ...cand, item: review({ version: 2 }) }, 'att1', NOW, id).items).toHaveLength(2);
  });
});

const fresh = (): VaultItem => addToVault([], 'u1', { item: review({}), reason: 'incorrect' }, 'att1', NOW, id).items[0];

describe('review rules', () => {
  it('a wrong retry resets the streak and keeps the item in learning', () => {
    let v = recordRetry(fresh(), true, false, NOW);
    v = recordRetry(v, false, false, NOW);
    expect(v).toMatchObject({ status: 'learning', correctStreak: 0, reviewCount: 2 });
  });
  it('repeating the SAME question correctly is not enough for mastery', () => {
    let v = fresh();
    for (let i = 0; i < 5; i++) v = recordRetry(v, true, false, NOW);
    expect(v.correctStreak).toBeGreaterThanOrEqual(MASTERY_STREAK);
    expect(v.status).toBe('learning');
  });
  it('mastery needs the streak AND at least one correct fresh related question', () => {
    let v = recordRetry(fresh(), true, false, NOW);
    expect(v.status).toBe('learning');
    v = recordRetry(v, true, true, NOW);
    expect(v).toMatchObject({ status: 'mastered', freshCorrect: 1 });
  });
  it('self-rating "understood" is recorded but can never grant mastery', () => {
    const v = selfRate(fresh(), 'understood', NOW);
    expect(v).toMatchObject({ selfRating: 'understood', status: 'new', correctStreak: 0 });
  });
  it('self-rating "needs practice" demotes a mastered item', () => {
    let v = recordRetry(recordRetry(fresh(), true, false, NOW), true, true, NOW);
    expect(v.status).toBe('mastered');
    v = selfRate(v, 'needs_practice', NOW);
    expect(v).toMatchObject({ status: 'learning', correctStreak: 0 });
  });
  it('spaced intervals lengthen with success and reset after a miss', () => {
    const a = recordRetry(fresh(), true, false, NOW);
    expect(Date.parse(a.nextReviewAt!)).toBe(days(3).getTime());
    const b = recordRetry(a, false, false, NOW);
    expect(Date.parse(b.nextReviewAt!)).toBe(days(1).getTime());
  });
  it('due logic: new items become due after a day; mastered items are not "due"', () => {
    const v = fresh();
    expect(isDue(v, NOW)).toBe(false);
    expect(isDue(v, days(1))).toBe(true);
    const m = recordRetry(recordRetry(v, true, false, NOW), true, true, NOW);
    expect(isDue(m, days(30))).toBe(false);
  });
  it('filters by skill, topic and status', () => {
    const a = fresh();
    const b = { ...fresh(), id: 'x', status: 'mastered' as const, skillTags: ['inference' as const], topicTags: ['coastal-engineering'] };
    expect(filterVault([a, b], { skill: 'inference' })).toEqual([b]);
    expect(filterVault([a, b], { topic: 'urban-ecology' })).toEqual([a]);
    expect(filterVault([a, b], { status: 'mastered' })).toEqual([b]);
    expect(filterVault([a, b], {})).toHaveLength(2);
  });
});
