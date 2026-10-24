import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, BookOpenText, CheckCircle2, ChevronLeft, ChevronRight, Clock, CloudOff, Flag, ListChecks, Loader2, RefreshCw, RotateCcw, Send } from 'lucide-react';
import { formatClock, timerLevel, type SaveStatus } from '@/engine';
import { LogoMark } from '@/components/ui/Logo';
import { Button, cn } from '@/components/ui/ui';

/**
 * Countdown display. It only DISPLAYS the server deadline held by useAttemptRunner (the one and only timer).
 * role="timer" with no live region, so assistive tech isn't spammed every second; threshold announcements are separate.
 * No animation: colour AND an icon/word change at the warning levels.
 */
export function TimerChip({ remaining }: { remaining: number | null }) {
  if (remaining === null) return null;
  const level = timerLevel(remaining);
  const style = { normal: 'bg-ink-3 text-paper', warn: 'bg-gold text-ink', urgent: 'bg-bad text-white', expired: 'bg-bad text-white' }[level];
  return (
    <div role="timer" aria-label="Time remaining" data-level={level} className={cn('flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[1.05rem] font-semibold tabular', style)}>
      {level === 'normal' ? <Clock className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
      <span>{formatClock(remaining)}</span>
      {level === 'warn' && <span className="hidden font-sans text-xs font-semibold md:inline">under 5 min</span>}
      {level === 'urgent' && <span className="hidden font-sans text-xs font-semibold md:inline">under 1 min</span>}
    </div>
  );
}

export function SaveIndicator({ status, detail, onRetry, online }: { status: SaveStatus; detail?: string; onRetry: () => void; online: boolean }) {
  if (!online) return <span className="flex items-center gap-1.5 text-xs font-semibold text-gold"><CloudOff className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Offline — keep this tab open</span></span>;
  switch (status) {
    case 'saving': return <span className="flex items-center gap-1.5 text-xs font-semibold text-mist-2"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /><span className="hidden sm:inline">Saving…</span></span>;
    case 'dirty': return <span className="flex items-center gap-1.5 text-xs font-semibold text-mist-2"><span className="h-2 w-2 rounded-full bg-mist" aria-hidden /><span className="hidden sm:inline">Unsaved changes</span></span>;
    case 'saved': return <span className="flex items-center gap-1.5 text-xs font-semibold text-mist-2"><CheckCircle2 className="h-4 w-4 text-gold" aria-hidden /><span className="hidden sm:inline">Saved</span></span>;
    case 'failed': return (
      <button onClick={onRetry} className="flex items-center gap-1.5 rounded-lg bg-bad px-2.5 py-1 text-xs font-semibold text-white" title={detail}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />Save failed — retry
      </button>
    );
    default: return <span className="hidden text-xs text-mist sm:inline">Autosave on</span>;
  }
}

export interface ToolbarSection { id: string; label: string; short: string; full: string }
export type Pane = 'passage' | 'questions';

/**
 * The persistent exam toolbar. ONE element tree: the rows reflow with CSS (flex-wrap + display:contents),
 * so there is exactly one progress read-out and one timer at every screen size.
 */
export function ExamToolbar(p: {
  title: string; sections: ToolbarSection[]; sectionIdx: number; onSection: (i: number) => void;
  remaining: number | null; saveStatus: SaveStatus; saveDetail?: string; onRetry: () => void; online: boolean;
  answered: number; total: number; flagged: number; onSubmit: () => void; submitting: boolean;
  pane: Pane; onPane: (p: Pane) => void; onResetLayout?: () => void;
}) {
  const pct = p.total ? Math.round((p.answered / p.total) * 100) : 0;
  return (
    <header className="on-dark flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 bg-ink px-3 py-2 text-paper sm:px-4 lg:flex-nowrap lg:gap-x-5">
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:max-w-[17rem] lg:flex-none">
        <LogoMark size={28} />
        <div className="min-w-0">
          <h1 className="truncate font-sans text-sm font-semibold leading-tight">{p.title}</h1>
          <p className="truncate text-xs text-mist-2">{p.sections[p.sectionIdx]?.full}</p>
        </div>
      </div>

      <div className="order-last flex basis-full items-center gap-2 lg:contents">
        <div role="tablist" aria-label="Exam panes" className="flex rounded-lg bg-ink-3 p-0.5 lg:hidden">
          {([['passage', 'Passage', BookOpenText], ['questions', 'Questions', ListChecks]] as const).map(([k, l, Icon]) => (
            <button key={k} role="tab" aria-selected={p.pane === k} onClick={() => p.onPane(k)}
              className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold', p.pane === k ? 'bg-paper text-ink' : 'text-mist-2')}><Icon className="h-3.5 w-3.5" aria-hidden />{l}</button>
          ))}
        </div>
        {p.sections.length > 1 && (
          <div role="tablist" aria-label="Passages" className="flex rounded-lg bg-ink-3 p-0.5">
            {p.sections.map((s, i) => (
              <button key={s.id} role="tab" aria-selected={p.sectionIdx === i} onClick={() => p.onSection(i)}
                aria-label={s.label} className={cn('whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold sm:px-3', p.sectionIdx === i ? 'bg-gold text-ink' : 'text-mist-2 hover:text-white')}><span aria-hidden className="sm:hidden">{s.short}</span><span aria-hidden className="hidden sm:inline">{s.label}</span></button>
            ))}
          </div>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2.5 lg:ml-0 lg:w-60">
          <div role="progressbar" aria-label="Questions answered" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.answered} className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-white/15 sm:block">
            <div className="h-full rounded-full bg-gold transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>
          <p role="status" className="whitespace-nowrap font-mono text-xs font-semibold tabular text-mist-2">
            <span aria-hidden className="sm:hidden">{p.answered}/{p.total}</span>
            <span className="sr-only sm:not-sr-only">{p.answered} of {p.total} answered</span>
            {p.flagged > 0 && <span className="text-gold"> · <Flag className="-mt-0.5 inline h-3 w-3" aria-hidden /> {p.flagged}<span className="sr-only"> flagged</span></span>}
          </p>
        </div>
      </div>

      <div className="order-2 flex items-center gap-2.5 sm:gap-3 lg:order-none lg:ml-auto">
        <SaveIndicator status={p.saveStatus} detail={p.saveDetail} onRetry={p.onRetry} online={p.online} />
        <TimerChip remaining={p.remaining} />
        {p.onResetLayout && (
          <button onClick={p.onResetLayout} aria-label="Reset panel layout" title="Reset panel layout" className="hidden rounded-lg p-2 text-mist-2 hover:bg-white/10 hover:text-white lg:block"><RotateCcw className="h-4 w-4" aria-hidden /></button>
        )}
        <Button variant="gold" className="px-3.5 py-2 text-sm sm:px-4" onClick={p.onSubmit} disabled={p.submitting}><Send className="h-4 w-4" aria-hidden />Submit</Button>
      </div>
    </header>
  );
}

export interface NavQuestion { id: string; number: number; sectionIndex: number }

/** Numbered palette: one scrollable row. State is conveyed by fill + icon + accessible name — never colour alone. */
export function QuestionNavigator({
  questions, current, answered, flagged, onJump,
}: { questions: NavQuestion[]; current: string | null; answered: (id: string) => boolean; flagged: (id: string) => boolean; onJump: (q: NavQuestion) => void }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [current]);
  return (
    <nav aria-label="Question navigator" className="min-w-0 flex-1">
      <div ref={row} className="flex items-center gap-1.5 overflow-x-auto px-1 py-1.5 [scrollbar-width:thin]">
        {questions.map((q, i) => {
          const a = answered(q.id), f = flagged(q.id), isCur = current === q.id;
          const newGroup = i === 0 || questions[i - 1].sectionIndex !== q.sectionIndex;
          return (
            <div key={q.id} className="flex shrink-0 items-center gap-1.5">
              {newGroup && <span className={cn('select-none font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-muted', i > 0 && 'ml-2 border-l border-ink/20 pl-2.5')} aria-hidden>P{q.sectionIndex + 1}</span>}
              <button type="button" onClick={() => onJump(q)} aria-current={isCur ? 'true' : undefined} data-state={a ? 'answered' : 'unanswered'}
                aria-label={`Question ${q.number}: ${a ? 'answered' : 'not answered'}${f ? ', flagged for review' : ''}`}
                className={cn('relative grid h-9 w-9 place-items-center rounded-lg border-2 font-mono text-[0.82rem] font-semibold transition-colors',
                  a ? 'border-ink bg-ink text-paper' : 'border-ink/30 bg-white text-ink hover:border-ink/70',
                  isCur && 'ring-2 ring-signal ring-offset-2 ring-offset-paper-2')}>
                {q.number}
                {f && <Flag className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full border border-ink/20 bg-gold p-0.5 text-ink" aria-hidden />}
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export function ExamFooter(p: { navigator: ReactNode; canPrev: boolean; canNext: boolean; onPrev: () => void; onNext: () => void }) {
  return (
    <footer className="shrink-0 border-t border-paper-edge bg-paper-2 px-2 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] sm:px-4">
      <div className="mx-auto flex max-w-[110rem] items-center gap-2">
        <Button variant="secondary" className="px-2.5 py-2 sm:px-3.5" disabled={!p.canPrev} onClick={p.onPrev} aria-label="Previous question"><ChevronLeft className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Previous</span></Button>
        {p.navigator}
        <Button variant="dark" className="px-2.5 py-2 sm:px-3.5" disabled={!p.canNext} onClick={p.onNext} aria-label="Next question"><span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        <ul className="ml-2 hidden items-center gap-3 border-l border-ink/15 pl-3 text-xs text-ink-3 2xl:flex" aria-label="Palette key">
          <li className="flex items-center gap-1.5"><span className="grid h-5 w-5 place-items-center rounded border-2 border-ink bg-ink text-[0.6rem] text-paper" aria-hidden>1</span>Answered</li>
          <li className="flex items-center gap-1.5"><span className="grid h-5 w-5 place-items-center rounded border-2 border-ink/30 bg-white text-[0.6rem]" aria-hidden>1</span>Not answered</li>
          <li className="flex items-center gap-1.5"><Flag className="h-4 w-4 rounded-full bg-gold p-0.5" aria-hidden />Flagged</li>
        </ul>
      </div>
    </footer>
  );
}
