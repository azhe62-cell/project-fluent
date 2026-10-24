import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { DEFAULT_SPLIT, KEY_STEP, MIN_PANE_PX, clampSplit, fractionFromPointer, loadSplit, saveSplit, splitBounds } from './split';
import { cn } from '@/components/ui/ui';

export interface SplitControls { reset: () => void; fraction: number }

/**
 * Desktop two-pane workspace with a draggable, keyboard-operable divider.
 *  - Pointer (mouse / touch / pen) drag with pointer capture.  - ←/→ move 2 %, Home/End jump to the limits, Enter/double-click reset.
 *  - Each pane scrolls independently (overflow lives on the panes, never on the page).
 * Below the `lg` breakpoint the parent renders a single-pane tabbed layout instead, so this is only mounted ≥ 1024 px.
 */
export function SplitPane({ left, right, leftLabel, rightLabel, controlsRef }: {
  left: ReactNode; right: ReactNode; leftLabel: string; rightLabel: string; controlsRef?: (c: SplitControls) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = useState(() => loadSplit(typeof window === 'undefined' ? null : window.localStorage));
  const [dragging, setDragging] = useState(false);

  const apply = useCallback((f: number, persist = true) => {
    const w = box.current?.getBoundingClientRect().width ?? 0;
    const next = w > 0 ? clampSplit(f, w) : Math.min(0.9, Math.max(0.1, f));
    setFraction(next);
    if (persist) saveSplit(window.localStorage, next);
  }, []);
  const reset = useCallback(() => { setFraction(DEFAULT_SPLIT); saveSplit(window.localStorage, DEFAULT_SPLIT); }, []);

  useEffect(() => { controlsRef?.({ reset, fraction }); }, [controlsRef, reset, fraction]);

  // keep the stored ratio legal when the window is resized
  useEffect(() => {
    const onResize = () => { const w = box.current?.getBoundingClientRect().width ?? 0; if (w > 0) setFraction((f) => clampSplit(f, w)); };
    window.addEventListener('resize', onResize); onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault(); (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId); setDragging(true);
  };
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragging || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setFraction(fractionFromPointer(e.clientX, r.left, r.width));
  };
  const endDrag = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragging) return; setDragging(false); (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId); saveSplit(window.localStorage, fraction);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const w = box.current?.getBoundingClientRect().width ?? 0; const { min, max } = splitBounds(w || 1200);
    if (e.key === 'ArrowLeft') { e.preventDefault(); apply(fraction - KEY_STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); apply(fraction + KEY_STEP); }
    else if (e.key === 'Home') { e.preventDefault(); apply(min); }
    else if (e.key === 'End') { e.preventDefault(); apply(max); }
    else if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); reset(); }
  };

  const pct = Math.round(fraction * 100);
  return (
    <div ref={box} className={cn('flex min-h-0 flex-1', dragging && 'cursor-col-resize select-none')} data-testid="split-workspace">
      <div className="relative min-h-0 min-w-0 shrink-0 overflow-y-auto overscroll-contain bg-paper" style={{ width: `${fraction * 100}%`, minWidth: MIN_PANE_PX }} role="region" aria-label={leftLabel} data-pane="passage" tabIndex={-1}>{left}</div>
      <div
        role="separator" aria-orientation="vertical" aria-label="Resize passage and questions panels. Arrow keys move, Home and End jump to the limits, Enter resets."
        aria-valuemin={Math.round(splitBounds(box.current?.getBoundingClientRect().width ?? 1200).min * 100)} aria-valuemax={Math.round(splitBounds(box.current?.getBoundingClientRect().width ?? 1200).max * 100)} aria-valuenow={pct}
        tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={onKey} onDoubleClick={reset}
        className={cn('group relative z-10 flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center border-x border-paper-edge bg-paper-2 transition-colors hover:bg-signal-soft focus-visible:bg-signal-soft', dragging && 'bg-signal-soft')} data-testid="split-divider">
        <GripVertical className="h-5 w-5 text-muted group-hover:text-signal-deep" aria-hidden />
      </div>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-white" style={{ minWidth: MIN_PANE_PX }} role="region" aria-label={rightLabel} data-pane="questions" tabIndex={-1} id="questions">{right}</div>
    </div>
  );
}
