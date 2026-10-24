import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Flag, HelpCircle, Minus, Plus, X } from 'lucide-react';
import { Button, Dialog, ErrorState, Notice, Spinner, cn } from '@/components/ui/ui';
import { QuestionBlock } from '@/components/exam/QuestionBlock';
import { ExamFooter, ExamToolbar, QuestionNavigator, type NavQuestion, type Pane } from '@/components/exam/ExamChrome';
import { SplitPane, type SplitControls } from '@/components/exam/SplitPane';
import { useAttemptRunner } from '@/components/exam/useAttemptRunner';
import { timerLevel } from '@/engine';
import { useDocumentTitle, useMediaQuery, useOnline } from '@/lib/hooks';

const TEXT_SIZES = ['0.98rem', '1.0625rem', '1.2rem'];
const TEXT_KEY = 'fluent.exam.textsize.v1';
const loadSize = () => { try { const n = Number(window.localStorage.getItem(TEXT_KEY)); return n >= 0 && n < TEXT_SIZES.length ? n : 1; } catch { return 1; } };

export default function Attempt() {
  const { attemptId = '' } = useParams();
  const r = useAttemptRunner(attemptId);
  const online = useOnline();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [sectionIdx, setSectionIdx] = useState(0);
  const [pane, setPane] = useState<Pane>('questions');
  const [confirming, setConfirming] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [size, setSize] = useState(loadSize);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const split = useRef<SplitControls | null>(null);
  // After Previous / Next / palette jumps we PIN the current question. The scroll-watcher below may only take over once the
  // learner really scrolls (wheel / touch / scroll keys). Without this, the last questions of a passage — which cannot scroll
  // to the top of the pane — were reported as the question above them, so "Next" appeared to do nothing.
  const pinned = useRef(false);
  // Jumps requested from inside the submit dialog run AFTER it has closed: closing a modal <dialog> restores focus to the
  // previously-focused control and scrolls to it, which would otherwise undo the jump.
  const afterClose = useRef<NavQuestion | null>(null);
  // Scroll/focus work happens in a layout effect AFTER React has committed the target section/pane (never in a frame callback).
  const [jumpReq, setJumpReq] = useState<{ id: string; n: number } | null>(null);
  const [resetTick, setResetTick] = useState(0);
  useDocumentTitle(r.session ? `${r.session.test.title} — exam` : 'Exam');

  const test = r.session?.test;
  const navQs: NavQuestion[] = useMemo(() => {
    if (!test) return [];
    return test.sections.flatMap((s, si) => s.groups.flatMap((g) => g.questionIds.map((id) => ({ id, number: test.questions.find((q) => q.id === id)!.number, sectionIndex: si }))));
  }, [test]);

  // The question nearest the top of the questions pane is "current" (drives the palette ring and Previous/Next).
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-pane="questions"]'); if (!root) return;
    const unpin = () => { pinned.current = false; };
    const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
    const onKey = (e: KeyboardEvent) => { if (scrollKeys.has(e.key) && !(e.target as HTMLElement).closest?.('input, textarea')) unpin(); };
    root.addEventListener('wheel', unpin, { passive: true }); root.addEventListener('touchmove', unpin, { passive: true }); root.addEventListener('keydown', onKey);
    const obs = new IntersectionObserver((es) => {
      if (pinned.current) return;
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setCurrent((vis.target as HTMLElement).dataset.question ?? null);
    }, { root, rootMargin: '0px 0px -70% 0px' });
    root.querySelectorAll('[data-question]').forEach((el) => obs.observe(el));
    return () => { obs.disconnect(); root.removeEventListener('wheel', unpin); root.removeEventListener('touchmove', unpin); root.removeEventListener('keydown', onKey); };
  }, [sectionIdx, test, pane, isDesktop]);

  const jump = useCallback((nq: NavQuestion) => {
    pinned.current = true;
    setSectionIdx(nq.sectionIndex); setPane('questions'); setCurrent(nq.id); setJumpReq({ id: nq.id, n: performance.now() });
  }, []);
  useLayoutEffect(() => {
    if (!jumpReq) return;
    const el = document.getElementById(`q-${jumpReq.id}`); if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'auto' });
    el.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
  }, [jumpReq]);
  useLayoutEffect(() => { if (resetTick) document.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => p.scrollTo?.({ top: 0 })); }, [resetTick]);

  const closeThenJump = (q: NavQuestion) => { afterClose.current = q; setConfirming(false); };
  const onDialogClosed = () => { if (r.submitState !== 'submitting') setConfirming(false); };
  // Runs after the commit in which <Dialog> closed itself (its effect runs first, and focus restoration is synchronous inside close()).
  useEffect(() => {
    if (confirming || !afterClose.current) return;
    const q = afterClose.current; afterClose.current = null;
    const t = setTimeout(() => jump(q), 0);
    return () => clearTimeout(t);
  }, [confirming, jump]);

  const changeSection = (i: number) => { pinned.current = false; setSectionIdx(i); setPane('questions'); setResetTick((t) => t + 1); };
  const setTextSize = (n: number) => { const v = Math.max(0, Math.min(TEXT_SIZES.length - 1, n)); setSize(v); try { window.localStorage.setItem(TEXT_KEY, String(v)); } catch { /* not persisted */ } };

  if (r.loadError) return <div className="p-8"><ErrorState message={r.loadError} /><p className="mt-4 text-center"><Link className="font-semibold text-signal-deep underline" to="/dashboard">Back to dashboard</Link></p></div>;
  if (!test || !r.session) return <Spinner label="Opening your exam" />;

  const section = test.sections[sectionIdx];
  const passage = test.passages.find((p) => p.id === section.passageId)!;
  const qById = new Map(test.questions.map((q) => [q.id, q]));
  const curIdx = Math.max(0, navQs.findIndex((q) => q.id === (current ?? navQs[0]?.id)));
  const unanswered = navQs.filter((q) => !r.stats.isAnswered(q.id));
  const flaggedQs = navQs.filter((q) => r.responses[q.id]?.flagged);
  const unsureQs = navQs.filter((q) => r.responses[q.id]?.unsure);
  const level = r.remaining === null ? 'normal' : timerLevel(r.remaining);
  const bannerKey = level === 'urgent' ? 'urgent' : level === 'warn' ? 'warn' : null;
  const sections = test.sections.map((s) => ({ id: s.id, label: s.title.split('—')[0].trim(), short: `P${test.sections.indexOf(s) + 1}`, full: s.title }));

  const passagePane = (
    <div className="mx-auto max-w-[44rem] px-6 py-7 lg:px-9">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-signal-deep">{passage.kicker}</p>
          <h2 className="mt-1 text-[1.7rem] font-semibold leading-tight">{passage.title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-paper-edge bg-white p-0.5" role="group" aria-label="Passage text size">
          <button onClick={() => setTextSize(size - 1)} disabled={size === 0} aria-label="Smaller text" className="rounded-md p-1.5 text-ink-3 hover:bg-paper disabled:opacity-35"><Minus className="h-4 w-4" aria-hidden /></button>
          <span className="px-1 font-mono text-xs text-muted" aria-hidden>Aa</span>
          <button onClick={() => setTextSize(size + 1)} disabled={size === TEXT_SIZES.length - 1} aria-label="Larger text" className="rounded-md p-1.5 text-ink-3 hover:bg-paper disabled:opacity-35"><Plus className="h-4 w-4" aria-hidden /></button>
        </div>
      </div>
      <div className="space-y-5">
        {passage.paragraphs.map((p, i) => (
          <p key={i} className="reading-text relative pl-9" style={{ fontSize: TEXT_SIZES[size] }}>
            {p.label && <span className="absolute left-0 top-[0.35em] grid h-6 w-6 place-items-center rounded-md bg-ink font-mono text-xs font-semibold text-paper" aria-label={`Paragraph ${p.label}`}>{p.label}</span>}
            {p.text}
          </p>
        ))}
      </div>
    </div>
  );

  const questionsPane = (
    <div className="mx-auto max-w-[44rem] px-4 py-6 sm:px-6 lg:px-8" onFocusCapture={(e) => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-question]')?.dataset.question; if (id) setCurrent(id); }}>
      {test.sections.length > 1 && <p className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted">Passage {sectionIdx + 1} of {test.sections.length}</p>}
      {section.groups.map((g) => (
        <section key={g.id} className="mb-9" aria-labelledby={`grp-${g.id}`}>
          <div className="rounded-lg border-l-4 border-signal bg-paper px-4 py-3">
            <h3 id={`grp-${g.id}`} className="font-display text-lg font-semibold">{g.heading}</h3>
            <p className="mt-0.5 text-sm text-ink-3">{g.instructions}</p>
          </div>
          {g.sharedOptions && (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-paper px-4 py-2.5 text-sm" aria-label="Paragraphs to choose from">
              {g.sharedOptions.map((o) => <li key={o.id}><b className="font-mono">{o.id}</b> <span className="text-muted">{o.label}</span></li>)}
            </ul>
          )}
          <div className={cn('mt-3 space-y-3', g.variant === 'summary' && 'rounded-xl border border-paper-edge bg-paper-2 p-3')}>
            {g.variant === 'summary' && <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-wider text-signal-deep">Summary</p>}
            {g.questionIds.map((id) => (
              <QuestionBlock key={id} question={qById.get(id)!} draft={r.responses[id]} sharedOptions={g.sharedOptions}
                onAnswer={(a) => r.setAnswer(id, a)} onFlag={() => r.toggleFlag(id)} onUnsure={() => r.toggleUnsure(id)} disabled={r.submitState === 'submitting'} />
            ))}
          </div>
        </section>
      ))}
      <div className="flex justify-between border-t border-paper-edge pt-6">
        <Button variant="secondary" disabled={sectionIdx === 0} onClick={() => changeSection(sectionIdx - 1)}>Previous passage</Button>
        {sectionIdx < test.sections.length - 1
          ? <Button variant="dark" onClick={() => changeSection(sectionIdx + 1)}>Next passage<ArrowRight className="h-4 w-4" aria-hidden /></Button>
          : <Button onClick={() => setConfirming(true)}>Review &amp; submit</Button>}
      </div>
      <div aria-hidden className="h-[38dvh]" />{/* lets every question, even the last, scroll to the top of the pane */}
    </div>
  );

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-paper-2 text-ink">
      <a href="#questions" className="skip-link">Skip to questions</a>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{r.announcement}</div>

      <ExamToolbar title={test.title} sections={sections} sectionIdx={sectionIdx} onSection={changeSection}
        remaining={r.remaining} saveStatus={r.saveStatus} saveDetail={r.saveDetail} onRetry={r.retrySave} online={online}
        answered={r.stats.answered} total={r.stats.total} flagged={r.stats.flagged}
        onSubmit={() => setConfirming(true)} submitting={r.submitState === 'submitting'}
        pane={pane} onPane={setPane} onResetLayout={isDesktop ? () => split.current?.reset() : undefined} />

      {!online && <div role="alert" className="shrink-0 bg-gold-soft px-4 py-2 text-center text-sm font-medium">You’re offline. Your answers are held on this page and will save when you reconnect — please don’t close the tab.</div>}
      {bannerKey && !dismissed[bannerKey] && (
        <div role="status" className={cn('flex shrink-0 items-center justify-center gap-3 px-4 py-1.5 text-sm font-semibold', bannerKey === 'urgent' ? 'bg-bad text-white' : 'bg-gold text-ink')}>
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {bannerKey === 'urgent' ? 'Less than 1 minute left.' : 'Less than 5 minutes left.'} {unanswered.length > 0 ? `${unanswered.length} question${unanswered.length > 1 ? 's' : ''} still unanswered.` : 'All questions answered.'}
          <button onClick={() => setDismissed((d) => ({ ...d, [bannerKey]: true }))} aria-label="Dismiss time warning" className="rounded p-0.5 hover:bg-black/10"><X className="h-4 w-4" aria-hidden /></button>
        </div>
      )}

      {isDesktop ? (
        <SplitPane left={passagePane} right={questionsPane} leftLabel={`Reading passage: ${passage.title}`} rightLabel="Questions" controlsRef={(c) => { split.current = c; }} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div data-pane="passage" role="region" aria-label={`Reading passage: ${passage.title}`} tabIndex={-1} className={cn('relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-paper', pane === 'passage' ? 'block' : 'hidden')}>{passagePane}</div>
          <div data-pane="questions" id="questions" role="region" aria-label="Questions" tabIndex={-1} className={cn('relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white', pane === 'questions' ? 'block' : 'hidden')}>{questionsPane}</div>
        </div>
      )}

      <ExamFooter canPrev={curIdx > 0} canNext={curIdx < navQs.length - 1} onPrev={() => jump(navQs[curIdx - 1])} onNext={() => jump(navQs[curIdx + 1])}
        navigator={<QuestionNavigator questions={navQs} current={current ?? navQs[0]?.id ?? null} answered={r.stats.isAnswered} flagged={(id) => !!r.responses[id]?.flagged} onJump={jump} />} />

      {r.expiring && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-6" role="alertdialog" aria-labelledby="timeup-title" aria-describedby="timeup-desc">
          <div className="max-w-sm rounded-2xl bg-white p-7 text-center shadow-2xl">
            <h2 id="timeup-title" className="text-2xl font-semibold">Time’s up</h2>
            <p id="timeup-desc" className="mt-2 text-muted">Submitting the answers that were saved before the deadline…</p>
            {r.submitState === 'error' && <><Notice tone="bad" className="mt-4 text-left">{r.submitError}</Notice><Button className="mt-4" onClick={() => r.submit('time_expired')}>Try again</Button></>}
          </div>
        </div>
      )}

      <Dialog size="lg" open={confirming && !r.expiring} onClose={onDialogClosed} title="Submit your final answers?"
        footer={<>
          {unanswered.length > 0 && <Button variant="secondary" onClick={() => closeThenJump(unanswered[0])} disabled={r.submitState === 'submitting'}>Review unanswered</Button>}
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={r.submitState === 'submitting'}>Keep working</Button>
          {r.canForce && <Button variant="danger" onClick={() => r.submit('learner_submitted', { force: true })} loading={r.submitState === 'submitting'}>Submit anyway</Button>}
          <Button onClick={() => r.submit('learner_submitted')} loading={r.submitState === 'submitting'}>{r.submitState === 'error' ? 'Try again' : 'Submit final answers'}</Button>
        </>}>
        <p className="text-sm"><b className="tabular text-ink">{r.stats.answered}</b> of {r.stats.total} questions answered.</p>
        <ReviewList icon={<AlertTriangle className="h-4 w-4 text-warn" aria-hidden />} title={`${unanswered.length} unanswered`} note="These score zero." tone="warn" items={unanswered} onPick={closeThenJump} />
        <ReviewList icon={<Flag className="h-4 w-4 text-warn" aria-hidden />} title={`${flaggedQs.length} flagged for review`} items={flaggedQs} onPick={closeThenJump} />
        <ReviewList icon={<HelpCircle className="h-4 w-4 text-signal-deep" aria-hidden />} title={`${unsureQs.length} marked unsure`} items={unsureQs} onPick={closeThenJump} />
        <p className="mt-4 text-sm">You can’t change your answers after submitting. We’ll confirm with the server before showing your report.</p>
        {r.submitError && <Notice tone="bad" className="mt-4">{r.submitError}</Notice>}
      </Dialog>
    </div>
  );
}

function ReviewList({ icon, title, note, items, onPick, tone }: { icon: React.ReactNode; title: string; note?: string; items: NavQuestion[]; onPick: (q: NavQuestion) => void; tone?: 'warn' }) {
  if (items.length === 0) return null;
  return (
    <div className={cn('mt-3 rounded-lg border p-3', tone === 'warn' ? 'border-warn/40 bg-gold-soft/60' : 'border-paper-edge bg-paper')}>
      <p className="flex items-center gap-2 text-sm font-semibold">{icon}{title}{note && <span className="font-normal text-ink-3"> — {note}</span>}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={title}>
        {items.map((q) => (
          <li key={q.id}><button type="button" onClick={() => onPick(q)} aria-label={`Go to question ${q.number}`} className="grid h-8 min-w-8 place-items-center rounded-md border-2 border-ink/30 bg-white px-1.5 font-mono text-xs font-semibold hover:border-ink">{q.number}</button></li>
        ))}
      </ul>
    </div>
  );
}

