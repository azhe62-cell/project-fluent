import type { Attempt, AttemptStatus, SubmissionKind } from './types';

/**
 * Attempt lifecycle:  created → in_progress → submitted → scored
 *                                         ↘ expired ───→ scored
 *
 * `expired` is explicit: the deadline (plus a short network grace) passed before the
 * learner submitted. An expired attempt is still scored — on the answers that were
 * saved before the deadline — but the report says so and it is never presented as a
 * normal on-time submission.
 */

/** Allowance for network latency between the learner's final click and the server. */
export const SUBMIT_GRACE_MS = 5_000;

const TRANSITIONS: Record<AttemptStatus, AttemptStatus[]> = {
  created: ['in_progress'],
  in_progress: ['submitted', 'expired'],
  submitted: ['scored'],
  expired: ['scored'],
  scored: [],
};

export const canTransition = (from: AttemptStatus, to: AttemptStatus) => TRANSITIONS[from].includes(to);

export function beginAttempt(attempt: Attempt, now: Date, durationSeconds: number): Attempt {
  if (!canTransition(attempt.status, 'in_progress')) throw new Error(`Cannot start an attempt that is ${attempt.status}`);
  return {
    ...attempt, status: 'in_progress',
    startedAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + durationSeconds * 1000).toISOString(),
  };
}

/** True when a still-open attempt is past its deadline + grace (lazy expiry / abandoned). */
export function isPastDeadline(attempt: Attempt, now: Date, graceMs = SUBMIT_GRACE_MS): boolean {
  return !!attempt.deadlineAt && now.getTime() > Date.parse(attempt.deadlineAt) + graceMs;
}

export type SaveGate = { ok: true } | { ok: false; reason: 'not_in_progress' | 'deadline_passed' };

/** Can the server still accept answer changes for this attempt right now? */
export function canAcceptResponses(attempt: Attempt, now: Date): SaveGate {
  if (attempt.status !== 'in_progress') return { ok: false, reason: 'not_in_progress' };
  if (isPastDeadline(attempt, now)) return { ok: false, reason: 'deadline_passed' };
  return { ok: true };
}

export interface FinalizeOutcome { attempt: Attempt; changed: boolean }

/**
 * Idempotent finalisation. Calling it again on an attempt that is already
 * submitted/expired/scored returns it unchanged (`changed: false`) — which is what
 * makes double-click and retry-after-timeout submissions safe.
 */
export function finalizeAttempt(attempt: Attempt, now: Date, requested: SubmissionKind = 'learner_submitted'): FinalizeOutcome {
  if (attempt.status !== 'in_progress') {
    if (attempt.status === 'created') throw new Error('Attempt has not been started');
    return { attempt, changed: false };
  }
  if (isPastDeadline(attempt, now)) {
    return {
      changed: true,
      attempt: { ...attempt, status: 'expired', submissionKind: 'time_expired', submittedAt: attempt.deadlineAt },
    };
  }
  // Within deadline + grace. A timer-triggered submit near the deadline is recorded as such.
  return {
    changed: true,
    attempt: { ...attempt, status: 'submitted', submissionKind: requested, submittedAt: now.toISOString() },
  };
}

export function markScored(attempt: Attempt): Attempt {
  if (!canTransition(attempt.status, 'scored')) throw new Error(`Cannot score an attempt that is ${attempt.status}`);
  return { ...attempt, status: 'scored' };
}

export function timeUsedSeconds(attempt: Attempt): number {
  if (!attempt.startedAt || !attempt.submittedAt) return 0;
  const end = Math.min(Date.parse(attempt.submittedAt), attempt.deadlineAt ? Date.parse(attempt.deadlineAt) : Infinity);
  return Math.max(0, Math.round((end - Date.parse(attempt.startedAt)) / 1000));
}
