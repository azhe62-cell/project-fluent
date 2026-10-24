/**
 * Pure maths for the resizable passage | questions divider (unit-tested).
 * The left pane's share is stored as a fraction of the workspace width.
 */
export const DEFAULT_SPLIT = 0.5;
export const MIN_PANE_PX = 340;          // neither pane may become narrower than this
export const KEY_STEP = 0.02;            // arrow-key step (2% of the width)
export const SPLIT_STORAGE_KEY = 'fluent.exam.split.v1';

/** Allowed range for the left fraction given the workspace width. If the width can't fit two minimum panes, fall back to the centre. */
export function splitBounds(totalPx: number, minPx = MIN_PANE_PX): { min: number; max: number } {
  if (!(totalPx > 0) || totalPx < minPx * 2 + 1) return { min: DEFAULT_SPLIT, max: DEFAULT_SPLIT };
  return { min: minPx / totalPx, max: 1 - minPx / totalPx };
}

export function clampSplit(fraction: number, totalPx: number, minPx = MIN_PANE_PX): number {
  const { min, max } = splitBounds(totalPx, minPx);
  const f = Number.isFinite(fraction) ? fraction : DEFAULT_SPLIT;
  return Math.min(max, Math.max(min, f));
}

/** Fraction for a pointer at `clientX` inside a workspace starting at `leftPx` and `totalPx` wide. */
export function fractionFromPointer(clientX: number, leftPx: number, totalPx: number, minPx = MIN_PANE_PX): number {
  if (!(totalPx > 0)) return DEFAULT_SPLIT;
  return clampSplit((clientX - leftPx) / totalPx, totalPx, minPx);
}

export function loadSplit(storage: Pick<Storage, 'getItem'> | null): number {
  try {
    const raw = storage?.getItem(SPLIT_STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0.1 && n < 0.9 ? n : DEFAULT_SPLIT;
  } catch { return DEFAULT_SPLIT; }
}
export function saveSplit(storage: Pick<Storage, 'setItem'> | null, fraction: number) {
  try { storage?.setItem(SPLIT_STORAGE_KEY, String(Math.round(fraction * 1000) / 1000)); } catch { /* private mode: layout just won't persist */ }
}
