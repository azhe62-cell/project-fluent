/**
 * Learning activity. Only COMPLETED practice counts (a submitted mock or a graded practice
 * session) — opening the site, or reading an explanation, does not.
 */
export interface ActivityEvent {
  type: 'attempt_completed' | 'practice_completed';
  at: string;
  /** Number of questions answered in this activity. */
  questions: number;
}

export const DAILY_GOAL_QUESTIONS = 5;

/** Local-calendar day key for an instant, given the learner's UTC offset in minutes (e.g. +300). */
export function dayKey(iso: string | number | Date, tzOffsetMinutes: number): string {
  const t = new Date(iso).getTime() + tzOffsetMinutes * 60_000;
  return new Date(t).toISOString().slice(0, 10);
}

const prevDay = (key: string) => new Date(Date.parse(key + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);

/**
 * Consecutive active days. Not shaming: if you haven't practised yet TODAY, yesterday's
 * streak is still shown (it only ends once a whole day is missed).
 */
export function currentStreak(events: ActivityEvent[], now: Date, tz: number): number {
  const days = new Set(events.filter((e) => e.questions > 0).map((e) => dayKey(e.at, tz)));
  let cursor = dayKey(now, tz);
  if (!days.has(cursor)) cursor = prevDay(cursor);
  let n = 0;
  while (days.has(cursor)) { n++; cursor = prevDay(cursor); }
  return n;
}

export function questionsToday(events: ActivityEvent[], now: Date, tz: number): number {
  const today = dayKey(now, tz);
  return events.filter((e) => dayKey(e.at, tz) === today).reduce((a, e) => a + e.questions, 0);
}

export function activityByDay(events: ActivityEvent[], now: Date, tz: number, days: number): { day: string; questions: number }[] {
  const out: { day: string; questions: number }[] = [];
  let cursor = dayKey(now, tz);
  for (let i = 0; i < days; i++) {
    out.unshift({ day: cursor, questions: events.filter((e) => dayKey(e.at, tz) === cursor).reduce((a, e) => a + e.questions, 0) });
    cursor = prevDay(cursor);
  }
  return out;
}
