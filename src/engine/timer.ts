/**
 * Server-authoritative timer.
 * The server issues `serverNow` and `deadlineAt`. The browser only DISPLAYS a countdown
 * derived from them; it never decides expiry. Re-sync on tab focus / reconnect.
 */
export interface ClockSync { offsetMs: number }

export const syncClock = (serverNowIso: string, clientNowMs: number): ClockSync => ({
  offsetMs: Date.parse(serverNowIso) - clientNowMs,
});

export const estimatedServerNow = (sync: ClockSync, clientNowMs: number) => clientNowMs + sync.offsetMs;

export const remainingMs = (deadlineIso: string, sync: ClockSync, clientNowMs: number) =>
  Math.max(0, Date.parse(deadlineIso) - estimatedServerNow(sync, clientNowMs));

export type TimerLevel = 'normal' | 'warn' | 'urgent' | 'expired';

export function timerLevel(remainingSeconds: number): TimerLevel {
  if (remainingSeconds <= 0) return 'expired';
  if (remainingSeconds <= 60) return 'urgent';
  if (remainingSeconds <= 300) return 'warn';
  return 'normal';
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Screen-reader thresholds. We announce only these — never every second. */
export const ANNOUNCE_AT = [600, 300, 60, 30] as const;

/**
 * Returns the most urgent (lowest) threshold crossed between two readings, or null.
 * After a long pause (sleeping tab) several may be crossed at once; we announce only one.
 */
export function crossedAnnouncement(prevSeconds: number, nowSeconds: number): number | null {
  let hit: number | null = null;
  for (const t of ANNOUNCE_AT) if (prevSeconds > t && nowSeconds <= t) hit = t;
  return hit;
}

export function spokenRemaining(seconds: number): string {
  if (seconds >= 120) return `${Math.round(seconds / 60)} minutes remaining`;
  if (seconds >= 60) return 'one minute remaining';
  return `${seconds} seconds remaining`;
}
