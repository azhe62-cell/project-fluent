import { describe, expect, it } from 'vitest';
import { buildReview, describeAnswer } from './review';
import { scoreAttempt } from './scoring';
import { currentStreak, questionsToday, activityByDay, dayKey, type ActivityEvent } from './streak';
import { readingMiniMock01 as test } from '@/content/reading-mini-mock-01.public';
import { readingMiniMock01Keys as keys } from '@/content/reading-mini-mock-01.keys';

const byId = new Map(test.questions.map((q) => [q.id, q]));

describe('describeAnswer', () => {
  it('uses option labels', () => {
    expect(describeAnswer(byId.get('rd01-q03')!, 'NOT_GIVEN')).toBe('Not Given');
    expect(describeAnswer(byId.get('rd01-q14')!, 'D')).toBe('Paragraph D');
    expect(describeAnswer(byId.get('rd01-q01')!, 'B')).toMatch(/^B — to find out/);
    expect(describeAnswer(byId.get('rd01-q09')!, ['C', 'A'])).toMatch(/^A — .*; C — /);
    expect(describeAnswer(byId.get('rd01-q06')!, '  Common ')).toBe('Common');
    expect(describeAnswer(byId.get('rd01-q06')!, null)).toBe('— no answer —');
  });
});

describe('buildReview', () => {
  it('pairs each question with the learner answer, correct answer and explanation', () => {
    const keyMap = new Map(keys.map((k) => [k.questionId, k]));
    const responses = { 'rd01-q03': 'FALSE', 'rd01-q06': 'common' };
    const score = scoreAttempt({ questions: test.questions, sections: test.sections, keys: keyMap, responses, scoredAt: 'x' });
    const review = buildReview({ questions: test.questions, keys: keyMap, responses, unsure: { 'rd01-q06': true }, score });
    expect(review).toHaveLength(19);
    const q3 = review.find((r) => r.questionId === 'rd01-q03')!;
    expect(q3).toMatchObject({ outcome: 'incorrect', submittedDisplay: 'False', correctDisplay: 'True' });
    expect(q3.explanation.length).toBeGreaterThan(30);
    expect(review.find((r) => r.questionId === 'rd01-q06')).toMatchObject({ outcome: 'correct', unsure: true });
    expect(review.find((r) => r.questionId === 'rd01-q01')!.outcome).toBe('unanswered');
  });
});

describe('activity & streak', () => {
  const ev = (iso: string, questions = 5): ActivityEvent => ({ type: 'practice_completed', at: iso, questions });
  const now = new Date('2026-03-10T15:00:00Z');
  it('counts consecutive days ending today', () => {
    expect(currentStreak([ev('2026-03-10T08:00:00Z'), ev('2026-03-09T20:00:00Z'), ev('2026-03-08T01:00:00Z')], now, 0)).toBe(3);
  });
  it('is not shaming: yesterday still counts if you have not practised yet today', () => {
    expect(currentStreak([ev('2026-03-09T20:00:00Z'), ev('2026-03-08T20:00:00Z')], now, 0)).toBe(2);
  });
  it('a missed day ends it; no activity = 0; zero-question events are ignored', () => {
    expect(currentStreak([ev('2026-03-10T08:00:00Z'), ev('2026-03-08T08:00:00Z')], now, 0)).toBe(1);
    expect(currentStreak([], now, 0)).toBe(0);
    expect(currentStreak([ev('2026-03-10T08:00:00Z', 0)], now, 0)).toBe(0);
  });
  it('respects the learner time zone (UTC+5 here)', () => {
    expect(dayKey('2026-03-09T20:30:00Z', 300)).toBe('2026-03-10'); // already "tomorrow" locally
    expect(currentStreak([ev('2026-03-09T20:30:00Z')], new Date('2026-03-10T01:00:00Z'), 300)).toBe(1);
  });
  it('sums questions today and buckets by day', () => {
    const e = [ev('2026-03-10T01:00:00Z', 4), ev('2026-03-10T09:00:00Z', 3), ev('2026-03-09T09:00:00Z', 7)];
    expect(questionsToday(e, now, 0)).toBe(7);
    expect(activityByDay(e, now, 0, 3)).toEqual([
      { day: '2026-03-08', questions: 0 }, { day: '2026-03-09', questions: 7 }, { day: '2026-03-10', questions: 7 },
    ]);
  });
});
