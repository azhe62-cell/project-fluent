import { describe, expect, it } from 'vitest';
import { DEFAULT_SPLIT, MIN_PANE_PX, clampSplit, fractionFromPointer, loadSplit, saveSplit, splitBounds } from './split';

describe('split maths', () => {
  it('keeps both panes at least the minimum width', () => {
    const { min, max } = splitBounds(1200);
    expect(min).toBeCloseTo(MIN_PANE_PX / 1200); expect(max).toBeCloseTo(1 - MIN_PANE_PX / 1200);
    expect(clampSplit(0.05, 1200) * 1200).toBeCloseTo(MIN_PANE_PX);
    expect((1 - clampSplit(0.95, 1200)) * 1200).toBeCloseTo(MIN_PANE_PX);
    expect(clampSplit(0.6, 1200)).toBe(0.6);
  });
  it('falls back to the centre when two minimum panes cannot fit, or the width is unknown', () => {
    expect(clampSplit(0.2, 600)).toBe(DEFAULT_SPLIT);
    expect(clampSplit(0.2, 0)).toBe(DEFAULT_SPLIT);
    expect(splitBounds(NaN)).toEqual({ min: DEFAULT_SPLIT, max: DEFAULT_SPLIT });
  });
  it('treats non-finite input (NaN / Infinity) as a reset to the centre rather than trusting it', () => { expect(clampSplit(NaN, 1200)).toBe(DEFAULT_SPLIT); expect(clampSplit(Infinity, 1200)).toBe(DEFAULT_SPLIT); expect(clampSplit(-Infinity, 1200)).toBe(DEFAULT_SPLIT); });
  it('converts a pointer position to a clamped fraction, relative to the workspace', () => {
    expect(fractionFromPointer(700, 100, 1200)).toBeCloseTo(0.5);
    expect(fractionFromPointer(0, 100, 1200) * 1200).toBeCloseTo(MIN_PANE_PX);
    expect(fractionFromPointer(5000, 100, 1200)).toBeCloseTo(1 - MIN_PANE_PX / 1200);
    expect(fractionFromPointer(10, 0, 0)).toBe(DEFAULT_SPLIT);
  });
  it('persists safely: bad / hostile stored values and a throwing storage never break the layout', () => {
    const mem = new Map<string, string>(); const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(loadSplit(st)).toBe(DEFAULT_SPLIT);
    saveSplit(st, 0.42); expect(loadSplit(st)).toBeCloseTo(0.42);
    for (const bad of ['abc', '5', '-1', '0.01', '']) { mem.set([...mem.keys()][0], bad); expect(loadSplit(st)).toBe(DEFAULT_SPLIT); }
    const boom = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(loadSplit(boom)).toBe(DEFAULT_SPLIT); expect(() => saveSplit(boom, 0.4)).not.toThrow(); expect(loadSplit(null)).toBe(DEFAULT_SPLIT);
  });
});
