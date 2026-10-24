import { describe, expect, it } from 'vitest';
import {
  beginAttempt, canAcceptResponses, canTransition, finalizeAttempt, isPastDeadline, markScored,
  SUBMIT_GRACE_MS, timeUsedSeconds,
} from './attempt';
import type { Attempt } from './types';

const created: Attempt = {
  id: 'a1', userId: 'u1', testId: 't1', testVersion: 1, status: 'created',
  createdAt: '2026-01-01T10:00:00.000Z', startedAt: null, deadlineAt: null, submittedAt: null, submissionKind: null,
};
const T0 = new Date('2026-01-01T10:00:00.000Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const started = () => beginAttempt(created, T0, 1200);

describe('attempt lifecycle', () => {
  it('start sets authoritative start and deadline', () => {
    const a = started();
    expect(a.status).toBe('in_progress');
    expect(a.startedAt).toBe('2026-01-01T10:00:00.000Z');
    expect(a.deadlineAt).toBe('2026-01-01T10:20:00.000Z');
  });
  it('cannot start twice', () => expect(() => beginAttempt(started(), T0, 1200)).toThrow());
  it('transition table is as documented', () => {
    expect(canTransition('created', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'submitted')).toBe(true);
    expect(canTransition('in_progress', 'expired')).toBe(true);
    expect(canTransition('submitted', 'scored')).toBe(true);
    expect(canTransition('expired', 'scored')).toBe(true);
    expect(canTransition('scored', 'submitted')).toBe(false);
    expect(canTransition('submitted', 'in_progress')).toBe(false);
    expect(canTransition('created', 'submitted')).toBe(false);
  });
  it('accepts saves before the deadline, within grace, and rejects them after', () => {
    const a = started();
    expect(canAcceptResponses(a, at(600)).ok).toBe(true);
    expect(canAcceptResponses(a, at(1200 + SUBMIT_GRACE_MS / 1000 - 1)).ok).toBe(true);
    expect(canAcceptResponses(a, at(1200 + SUBMIT_GRACE_MS / 1000 + 1))).toEqual({ ok: false, reason: 'deadline_passed' });
    expect(canAcceptResponses(created, T0)).toEqual({ ok: false, reason: 'not_in_progress' });
  });
  it('on-time submit → submitted / learner_submitted', () => {
    const { attempt, changed } = finalizeAttempt(started(), at(900));
    expect(changed).toBe(true);
    expect(attempt).toMatchObject({ status: 'submitted', submissionKind: 'learner_submitted', submittedAt: at(900).toISOString() });
  });
  it('timer-triggered submit at the deadline is accepted and recorded as time_expired', () => {
    const { attempt } = finalizeAttempt(started(), at(1201), 'time_expired');
    expect(attempt).toMatchObject({ status: 'submitted', submissionKind: 'time_expired' });
  });
  it('a late submit is explicitly EXPIRED, never a normal submission; submittedAt is pinned to the deadline', () => {
    const { attempt } = finalizeAttempt(started(), at(2000));
    expect(attempt).toMatchObject({ status: 'expired', submissionKind: 'time_expired', submittedAt: '2026-01-01T10:20:00.000Z' });
    expect(isPastDeadline(started(), at(2000))).toBe(true);
  });
  it('finalisation is idempotent: a second submit changes nothing', () => {
    const first = finalizeAttempt(started(), at(900));
    const second = finalizeAttempt(first.attempt, at(905));
    expect(second.changed).toBe(false);
    expect(second.attempt).toEqual(first.attempt);
    const scored = markScored(first.attempt);
    expect(finalizeAttempt(scored, at(910)).changed).toBe(false);
  });
  it('cannot finalise an attempt that was never started', () => expect(() => finalizeAttempt(created, T0)).toThrow());
  it('submitted and expired attempts can be scored; in_progress cannot', () => {
    expect(markScored(finalizeAttempt(started(), at(10)).attempt).status).toBe('scored');
    expect(markScored(finalizeAttempt(started(), at(5000)).attempt).status).toBe('scored');
    expect(() => markScored(started())).toThrow();
  });
  it('time used is clamped to the allowed duration', () => {
    expect(timeUsedSeconds(finalizeAttempt(started(), at(900)).attempt)).toBe(900);
    expect(timeUsedSeconds(finalizeAttempt(started(), at(5000)).attempt)).toBe(1200);
    expect(timeUsedSeconds(started())).toBe(0);
  });
});
