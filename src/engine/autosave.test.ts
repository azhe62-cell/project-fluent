import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveQueue, applyIncomingResponse, type SaveStatus } from './autosave';
import type { ResponseDraft } from './types';

const d = (questionId: string, answer: string | null, seq: number): ResponseDraft => ({ questionId, answer, flagged: false, unsure: false, seq });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AutosaveQueue', () => {
  it('debounces rapid edits into one request carrying only the newest draft', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue({ save, debounceMs: 500 });
    q.enqueue(d('q1', 'A', 1)); q.enqueue(d('q1', 'B', 2)); q.enqueue(d('q1', 'C', 3));
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual([d('q1', 'C', 3)]);
    expect(q.status).toBe('saved');
    expect(q.hasUnsaved()).toBe(false);
  });

  it('reports dirty → saving → saved', async () => {
    const seen: SaveStatus[] = [];
    const q = new AutosaveQueue({ save: async () => {}, debounceMs: 100, onStatus: (s) => seen.push(s) });
    q.enqueue(d('q1', 'A', 1));
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(['dirty', 'saving', 'saved']);
  });

  it('retries transient failures with back-off and then succeeds, without losing the answer', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('net')).mockRejectedValueOnce(new Error('net')).mockResolvedValue(undefined);
    const q = new AutosaveQueue({ save, debounceMs: 100, retryDelaysMs: [1000, 2000] });
    q.enqueue(d('q1', 'A', 1));
    await vi.advanceTimersByTimeAsync(100);
    expect(q.status).toBe('saving');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(3);
    expect(q.status).toBe('saved');
    expect(q.hasUnsaved()).toBe(false);
  });

  it('when retries run out the status is "failed" but the drafts stay queued; a later flush recovers', async () => {
    let online = false;
    const save = vi.fn(async () => { if (!online) throw new Error('offline'); });
    const q = new AutosaveQueue({ save, debounceMs: 100, retryDelaysMs: [100] });
    q.enqueue(d('q1', 'A', 1));
    await vi.advanceTimersByTimeAsync(100 + 100);
    expect(q.status).toBe('failed');
    expect(q.hasUnsaved()).toBe(true); // safe to warn the learner
    online = true;
    const ok = q.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(await ok).toBe(true);
    expect(q.status).toBe('saved');
    expect(q.hasUnsaved()).toBe(false);
  });

  it('a newer edit made while an older request is in flight is NOT discarded and is sent next', async () => {
    const release: Array<() => void> = [];
    const save = vi.fn((_b: ResponseDraft[]) => new Promise<void>((res) => release.push(res)));
    const q = new AutosaveQueue({ save, debounceMs: 100 });
    q.enqueue(d('q1', 'A', 1));
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
    q.enqueue(d('q1', 'B', 2)); // edit during flight
    release[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.hasUnsaved()).toBe(true); // seq 2 still pending
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual([d('q1', 'B', 2)]);
    release[1]();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.status).toBe('saved');
    expect(q.hasUnsaved()).toBe(false);
  });

  it('batches different questions together', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue({ save, debounceMs: 100 });
    q.enqueue(d('q1', 'A', 1)); q.enqueue(d('q2', 'TRUE', 1));
    await vi.advanceTimersByTimeAsync(100);
    expect(save.mock.calls[0][0].map((x: ResponseDraft) => x.questionId).sort()).toEqual(['q1', 'q2']);
  });

  it('ignores a stale caller (lower seq than what is queued)', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue({ save, debounceMs: 100 });
    q.enqueue(d('q1', 'B', 5)); q.enqueue(d('q1', 'A', 4));
    await vi.advanceTimersByTimeAsync(100);
    expect(save.mock.calls[0][0]).toEqual([d('q1', 'B', 5)]);
  });

  it('a fatal server verdict (deadline passed) stops further sending and reports failure', async () => {
    const save = vi.fn().mockResolvedValue({ fatal: 'deadline_passed' });
    const q = new AutosaveQueue({ save, debounceMs: 100 });
    q.enqueue(d('q1', 'A', 1));
    await vi.advanceTimersByTimeAsync(100);
    expect(q.status).toBe('failed');
    expect(q.fatal).toBe('deadline_passed');
    q.enqueue(d('q1', 'B', 2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('dispose cancels a pending debounce', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const q = new AutosaveQueue({ save, debounceMs: 100 });
    q.enqueue(d('q1', 'A', 1)); q.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('applyIncomingResponse (server merge rule)', () => {
  it('applies newer, ignores equal or older — simultaneous saves cannot overwrite newer answers', () => {
    const base = { seq: 5, answer: 'B' };
    expect(applyIncomingResponse(undefined, { seq: 1, answer: 'A' }).applied).toBe(true);
    expect(applyIncomingResponse(base, { seq: 6, answer: 'C' })).toEqual({ value: { seq: 6, answer: 'C' }, applied: true });
    expect(applyIncomingResponse(base, { seq: 5, answer: 'X' })).toEqual({ value: base, applied: false });
    expect(applyIncomingResponse(base, { seq: 2, answer: 'A' })).toEqual({ value: base, applied: false });
  });
  it('out-of-order arrival converges on the highest seq', () => {
    let cur: { seq: number; answer: string } | undefined;
    for (const inc of [{ seq: 3, answer: 'C' }, { seq: 1, answer: 'A' }, { seq: 2, answer: 'B' }]) cur = applyIncomingResponse(cur, inc).value;
    expect(cur).toEqual({ seq: 3, answer: 'C' });
  });
});
