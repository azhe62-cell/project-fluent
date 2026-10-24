import type { ResponseDraft } from './types';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed';

export interface SaveOutcome {
  /** Set when the server will never accept further saves for this attempt. */
  fatal?: 'deadline_passed' | 'not_in_progress' | 'forbidden';
}

export interface AutosaveOptions {
  /** Send a batch to the server. Throw for transient failures (network, 5xx). */
  save: (batch: ResponseDraft[]) => Promise<SaveOutcome | void>;
  onStatus?: (status: SaveStatus, detail?: string) => void;
  debounceMs?: number;
  retryDelaysMs?: number[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Debounced, retrying, last-write-wins autosave.
 *
 *  - Only the newest draft per question is kept (`seq` is monotonic per question).
 *  - A draft is removed from the queue only after the server confirms it, and only if
 *    the learner has not changed that question again in the meantime — so an older
 *    in-flight request can never delete (or overwrite) a newer answer.
 *  - Transient errors retry with back-off; after the retries run out the status becomes
 *    `failed` but the drafts stay queued, so nothing is lost until the page closes.
 */
export class AutosaveQueue {
  status: SaveStatus = 'idle';
  fatal: SaveOutcome['fatal'];
  private pending = new Map<string, ResponseDraft>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<boolean> | null = null;
  private readonly debounceMs: number;
  private readonly delays: number[];

  constructor(private readonly opts: AutosaveOptions) {
    this.debounceMs = opts.debounceMs ?? 700;
    this.delays = opts.retryDelaysMs ?? [1000, 2000, 4000];
  }

  enqueue(draft: ResponseDraft): void {
    if (this.fatal) return;
    const cur = this.pending.get(draft.questionId);
    if (cur && cur.seq > draft.seq) return; // stale caller
    this.pending.set(draft.questionId, draft);
    this.setStatus('dirty');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, this.debounceMs);
  }

  /** True while there are answers the server has not confirmed. */
  hasUnsaved(): boolean { return this.pending.size > 0; }

  flush(): Promise<boolean> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  dispose(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  private setStatus(s: SaveStatus, detail?: string) { this.status = s; this.opts.onStatus?.(s, detail); }

  private async drain(): Promise<boolean> {
    while (this.pending.size > 0) {
      const batch = [...this.pending.values()];
      this.setStatus('saving');
      let attempt = 0;
      for (;;) {
        try {
          const out = await this.opts.save(batch);
          if (out && out.fatal) {
            this.fatal = out.fatal;
            this.setStatus('failed', out.fatal);
            return false;
          }
          for (const d of batch) {
            const cur = this.pending.get(d.questionId);
            if (cur && cur.seq <= d.seq) this.pending.delete(d.questionId);
          }
          break;
        } catch (err) {
          if (attempt >= this.delays.length) {
            this.setStatus('failed', err instanceof Error ? err.message : 'network');
            return false;
          }
          await sleep(this.delays[attempt++]);
        }
      }
    }
    this.setStatus('saved');
    return true;
  }
}

/**
 * Server-side merge rule used by both adapters: keep the draft with the highest `seq`.
 * Returns whether the incoming draft was applied (false = stale, safely ignored).
 */
export function applyIncomingResponse<T extends { seq: number }>(
  existing: T | undefined, incoming: T,
): { value: T; applied: boolean } {
  if (existing && existing.seq >= incoming.seq) return { value: existing, applied: false };
  return { value: incoming, applied: true };
}
