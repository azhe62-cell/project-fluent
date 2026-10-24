import { describe, expect, it } from 'vitest';
import { crossedAnnouncement, formatClock, remainingMs, spokenRemaining, syncClock, timerLevel, estimatedServerNow } from './timer';

describe('server-authoritative timer', () => {
  const deadline = '2026-01-01T10:20:00.000Z';
  it('corrects for a client clock that is wrong', () => {
    // Client clock is 10 minutes FAST relative to the server.
    const serverNow = '2026-01-01T10:00:00.000Z';
    const clientNow = Date.parse('2026-01-01T10:10:00.000Z');
    const sync = syncClock(serverNow, clientNow);
    expect(estimatedServerNow(sync, clientNow)).toBe(Date.parse(serverNow));
    expect(remainingMs(deadline, sync, clientNow)).toBe(20 * 60 * 1000);
    // 5 real seconds later the display has advanced by 5 seconds, not by clock error.
    expect(remainingMs(deadline, sync, clientNow + 5000)).toBe(20 * 60 * 1000 - 5000);
  });
  it('never goes negative', () => {
    const sync = syncClock('2026-01-01T11:00:00.000Z', 0);
    expect(remainingMs(deadline, sync, 0)).toBe(0);
  });
  it('re-sync after a tab was asleep jumps to the true remaining time', () => {
    const t0 = Date.parse('2026-01-01T10:00:00.000Z');
    const stale = syncClock('2026-01-01T10:00:00.000Z', t0);
    // browser throttled timers; on focus the server says it is actually 10:12
    const fresh = syncClock('2026-01-01T10:12:00.000Z', t0 + 1000);
    expect(remainingMs(deadline, fresh, t0 + 1000)).toBe(8 * 60 * 1000);
    expect(remainingMs(deadline, stale, t0 + 1000)).toBeGreaterThan(19 * 60 * 1000);
  });
  it('levels', () => {
    expect(timerLevel(900)).toBe('normal');
    expect(timerLevel(300)).toBe('warn');
    expect(timerLevel(60)).toBe('urgent');
    expect(timerLevel(0)).toBe('expired');
  });
  it('formats clocks', () => {
    expect(formatClock(1200)).toBe('20:00');
    expect(formatClock(59.2)).toBe('01:00');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(-4)).toBe('00:00');
  });
  it('announces only at thresholds, never each second', () => {
    expect(crossedAnnouncement(301, 300)).toBe(300);
    expect(crossedAnnouncement(300, 299)).toBeNull();
    expect(crossedAnnouncement(1000, 700)).toBeNull();
    expect(crossedAnnouncement(1000, 400)).toBe(600);
    expect(crossedAnnouncement(1000, 50)).toBe(60); // big jump after a sleeping tab → most urgent only
    expect(crossedAnnouncement(65, 59)).toBe(60);
    expect(spokenRemaining(300)).toBe('5 minutes remaining');
    expect(spokenRemaining(60)).toBe('one minute remaining');
    expect(spokenRemaining(30)).toBe('30 seconds remaining');
  });
});
