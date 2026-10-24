import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AlertTriangle, BookMarked, CheckCircle2, CircleDashed, CircleHelp, ChevronDown, XCircle } from 'lucide-react';
import { SKILL_LABELS, TYPE_LABELS, formatClock, type QuestionOutcome, type ReviewItem } from '@/engine';
import { Badge, Button, Card, EmptyState, ErrorState, LinkButton, Meter, Notice, Spinner, cn } from '@/components/ui/ui';
import { useServices } from '@/lib/services-context';
import { formatDateTime, useAsync, useDocumentTitle } from '@/lib/hooks';

const outcomeMeta: Record<QuestionOutcome, { label: string; tone: 'ok' | 'bad' | 'warn' | 'neutral'; Icon: typeof CheckCircle2 }> = {
  correct: { label: 'Correct', tone: 'ok', Icon: CheckCircle2 },
  incorrect: { label: 'Incorrect', tone: 'bad', Icon: XCircle },
  partial: { label: 'Partly correct', tone: 'warn', Icon: CircleHelp },
  unanswered: { label: 'Unanswered', tone: 'neutral', Icon: CircleDashed },
};

export default function Results() {
  const { attemptId = '' } = useParams();
  const { assessments } = useServices();
  const { data, error, loading, reload } = useAsync(async () => {
    const [result, vault, attempts] = await Promise.all([assessments.getResult(attemptId), assessments.listVault(), assessments.listAttempts()]);
    return { result, vault, openAttempt: attempts.find((a) => a.id === attemptId && a.status === 'in_progress') };
  }, [attemptId, assessments]);
  const canVault = assessments.capabilities.vault;
  const [filter, setFilter] = useState<'all' | 'attention' | 'unsure'>('attention');
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  useDocumentTitle('Your report');

  if (loading) return <Spinner label="Loading your report" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (data?.openAttempt) return <Navigate to={`/attempts/${attemptId}`} replace />;
  if (!data?.result) return <EmptyState title="We couldn’t find that report" action={<LinkButton to="/history" variant="secondary">View history</LinkButton>}>It may belong to another account, or the attempt hasn’t been submitted.</EmptyState>;

  const { result: r, vault } = data;
  const inVault = (id: string, v: number) => saved.has(id) || vault.some((x) => x.questionId === id && x.questionVersion === v);
  const eligible = (i: ReviewItem) => i.outcome !== 'correct' || i.unsure;
  const attention = r.review.filter((i) => i.outcome !== 'correct');
  const shown = filter === 'all' ? r.review : filter === 'unsure' ? r.review.filter((i) => i.unsure) : attention;
  const savable = r.review.filter((i) => eligible(i) && !inVault(i.questionId, i.version));
  const expired = r.submissionKind === 'time_expired';
  const pct = r.score.maxScore ? Math.round((r.score.rawScore / r.score.maxScore) * 100) : 0;
  const skills = r.score.skillScores.filter((s) => s.questions >= 2).sort((a, b) => a.awarded / a.max - b.awarded / b.max);

  const save = async (ids?: string[]) => {
    setSaveErr(null);
    try {
      const res = await assessments.addToVault(attemptId, ids);
      setSaved((s) => new Set([...s, ...(ids ?? savable.map((i) => i.questionId))]));
      setNotice(res.added ? `Saved ${res.added} to your Mistake Vault.` : 'Those were already in your vault.');
    } catch (e) { setSaveErr(e instanceof Error ? e.message : 'Could not save to the vault.'); }
  };

  return (
    <div>
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-signal-deep">Report · {r.testTitle} · v{r.testVersion}</p>
      {expired && (
        <Notice tone="warn" title="Time ran out" className="mt-4">
          This attempt was recorded as <b>expired</b>. It was scored only on answers saved before the deadline, so it isn’t comparable to an on-time submission.
        </Notice>
      )}

      <Card className="mt-5 overflow-hidden">
        <div className="on-dark grid gap-6 bg-ink p-7 text-paper sm:grid-cols-[auto_1fr] sm:items-end">
          <div>
            <p className="text-sm text-mist-2">Practice marks</p>
            <p className="font-display text-7xl font-semibold leading-none tabular">{r.score.rawScore}<span className="text-3xl text-mist"> / {r.score.maxScore}</span></p>
            <p className="mt-2 text-sm text-mist-2">{pct}% of available marks</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 sm:justify-self-end">
            {[['Correct', r.score.counts.correct], ['Incorrect', r.score.counts.incorrect], ['Partly', r.score.counts.partial], ['Unanswered', r.score.counts.unanswered]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl bg-ink-3/70 px-4 py-2.5"><dt className="text-xs text-mist-2">{l as string}</dt><dd className="font-mono text-2xl font-semibold tabular">{v as number}</dd></div>
            ))}
          </dl>
        </div>
        <div className="grid gap-px bg-paper-edge text-sm sm:grid-cols-3">
          <p className="bg-white px-5 py-3"><span className="text-muted">Time used </span><b className="tabular">{formatClock(r.timeUsedSeconds)}</b></p>
          <p className="bg-white px-5 py-3"><span className="text-muted">Submitted </span><b>{formatDateTime(r.submittedAt)}</b></p>
          <p className="bg-white px-5 py-3"><span className="text-muted">Marking </span><b>{r.score.scoringVersion}</b></p>
        </div>
      </Card>
      <p className="mt-3 text-sm text-muted">{r.scoringNote} Practice marks are independent estimates, not official results.</p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-xl font-semibold">By passage</h2>
          <div className="mt-5 space-y-5">
            {r.score.sectionScores.map((s) => (
              <div key={s.sectionId}><div className="mb-1.5 flex justify-between text-sm font-medium"><span>{s.title.replace(/^Passage \d — /, '')}</span><span className="tabular text-muted">{s.awarded}/{s.max}</span></div><Meter value={s.awarded} max={s.max} label={s.title} /></div>
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-xl font-semibold">By skill</h2>
          {skills.length === 0 ? <p className="mt-3 text-sm text-muted">Not enough questions per skill in this test to say anything useful yet.</p> : (
            <div className="mt-5 space-y-4">
              {skills.map((s) => (
                <div key={s.skill}><div className="mb-1.5 flex justify-between text-sm font-medium"><span>{SKILL_LABELS[s.skill]}</span><span className="tabular text-muted">{s.awarded}/{s.max}</span></div><Meter value={s.awarded} max={s.max} label={SKILL_LABELS[s.skill]} tone={s.awarded / s.max < 0.5 ? 'warn' : 'signal'} /></div>
              ))}
              <p className="text-xs text-muted">A question counts toward every skill it involves, so skill totals overlap. Small samples — treat as a pointer, not a verdict.</p>
            </div>
          )}
        </Card>
      </div>

      <section className="mt-12" aria-labelledby="review-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 id="review-h" className="text-2xl font-semibold">Question review</h2><p className="text-sm text-muted">Your answer, the correct answer, and why.</p></div>
          {canVault && savable.length > 0 && <Button variant="dark" onClick={() => save()}><BookMarked className="h-4 w-4" aria-hidden />Save {savable.length} to Mistake Vault</Button>}
        </div>
        {notice && <Notice tone="ok" className="mt-4">{notice} <Link to="/mistake-vault" className="font-semibold underline">Open vault</Link></Notice>}
        {saveErr && <Notice tone="bad" className="mt-4">{saveErr}</Notice>}
        <div className="mt-4 flex gap-2" role="tablist" aria-label="Filter review">
          {([['attention', `Needs attention (${attention.length})`], ['unsure', `Marked unsure (${r.review.filter((i) => i.unsure).length})`], ['all', `All (${r.review.length})`]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn('rounded-chip px-4 py-1.5 text-sm font-semibold ring-1 ring-inset', filter === k ? 'bg-ink text-paper ring-ink' : 'bg-white text-ink-3 ring-ink/15 hover:ring-ink/40')}>{l}</button>
          ))}
        </div>
        {shown.length === 0 ? <div className="mt-4"><EmptyState icon={<CheckCircle2 />} title="Nothing to show here">{filter === 'attention' ? 'Every question was answered correctly. Nicely done.' : 'No questions in this view.'}</EmptyState></div> : (
          <ul className="mt-4 space-y-3">
            {shown.map((i) => {
              const m = outcomeMeta[i.outcome];
              return (
                <li key={i.questionId}>
                  <details className="group rounded-sheet border border-paper-edge bg-white open:shadow-sheet" open={i.outcome !== 'correct' && filter === 'attention' && shown.length <= 3}>
                    <summary className="flex cursor-pointer list-none items-start gap-4 p-4">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-paper font-mono text-sm font-semibold">{i.number}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.95rem] font-medium">{i.prompt}</span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-2"><Badge tone={m.tone} icon={<m.Icon className="h-3.5 w-3.5" aria-hidden />}>{m.label}</Badge><Badge>{TYPE_LABELS[i.type]}</Badge>{i.unsure && <Badge tone="signal">Marked unsure</Badge>}{inVault(i.questionId, i.version) && <Badge tone="gold">In vault</Badge>}</span>
                      </span>
                      <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="space-y-3 border-t border-paper-edge px-4 pb-4 pt-4 text-sm">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl bg-paper p-3"><p className="text-xs font-semibold text-muted">Your answer</p><p className="mt-1 font-medium">{i.submittedDisplay}</p></div>
                        <div className="rounded-xl bg-ok/10 p-3"><p className="text-xs font-semibold text-ok">Correct answer</p><p className="mt-1 font-medium">{i.correctDisplay}</p></div>
                      </div>
                      <p className="leading-relaxed text-ink-3"><b className="text-ink">Why: </b>{i.explanation}</p>
                      {canVault && eligible(i) && !inVault(i.questionId, i.version) && <Button variant="secondary" className="px-3 py-1.5 text-sm" onClick={() => save([i.questionId])}><BookMarked className="h-4 w-4" aria-hidden />Save to Mistake Vault</Button>}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Card className="mt-12 flex flex-wrap items-center justify-between gap-4 p-6">
        <div><h2 className="text-xl font-semibold">What next?</h2><p className="mt-1 flex items-center gap-2 text-sm text-muted"><AlertTriangle className="h-4 w-4" aria-hidden />One short test can’t define your level — use it to choose what to practice.</p></div>
        <div className="flex flex-wrap gap-3">{canVault && <LinkButton to="/practice/recommended">Practice recommended</LinkButton>}<LinkButton to="/dashboard" variant="secondary">Dashboard</LinkButton><LinkButton to="/history" variant="ghost">History</LinkButton></div>
      </Card>
    </div>
  );
}
