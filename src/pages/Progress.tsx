import { BarChart3 } from 'lucide-react';
import { SKILL_LABELS, activityByDay, skillStats } from '@/engine';
import { Card, EmptyState, ErrorState, LinkButton, Meter, Notice, PageHeader, Spinner } from '@/components/ui/ui';
import { useServices } from '@/lib/services-context';
import { formatDate, tzOffsetMinutes, useAsync, useDocumentTitle } from '@/lib/hooks';

export default function Progress() {
  useDocumentTitle('Progress');
  const { assessments } = useServices();
  const { data, error, loading, reload } = useAsync(async () => {
    const [results, records, activity, vault] = await Promise.all([assessments.listResults(), assessments.getAnswerRecords(), assessments.getActivity(), assessments.listVault()]);
    return { results: [...results].reverse(), records, activity, vault };
  }, [assessments]);
  if (loading) return <Spinner label="Loading progress" />;
  if (error || !data) return <ErrorState message={error ?? 'Unknown error'} onRetry={reload} />;
  const { results, records, activity, vault } = data;

  if (results.length === 0 && records.length === 0)
    return <div><PageHeader eyebrow="Progress" title="Your progress" /><EmptyState icon={<BarChart3 />} title="Nothing to chart yet" action={<LinkButton to="/practice">Take a mock exam</LinkButton>}>Progress is drawn only from your real, saved attempts — we never show placeholder numbers.</EmptyState></div>;

  const pts = results.map((r) => ({ id: r.attemptId, pct: r.score.maxScore ? (r.score.rawScore / r.score.maxScore) * 100 : 0, label: formatDate(r.submittedAt), expired: r.submissionKind === 'time_expired' }));
  const W = 560, H = 190, pad = 34;
  const x = (i: number) => (pts.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (pts.length - 1));
  const y = (p: number) => H - pad - (p / 100) * (H - pad * 2);
  const skills = [...skillStats(records)].filter(([, s]) => s.total >= 3).sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total);
  const days = activityByDay(activity, new Date(), tzOffsetMinutes(), 14);
  const maxQ = Math.max(1, ...days.map((d) => d.questions));
  const retried = records.filter((r) => r.source !== 'mock').length;

  return (
    <div>
      <PageHeader eyebrow="Progress" title="How you’re doing">Trends from your saved attempts. These are practice estimates, not a validated measure of proficiency.</PageHeader>

      <Card className="p-6">
        <h2 className="text-xl font-semibold">Raw-score trend</h2>
        {pts.length < 2 && <p className="mt-1 text-sm text-muted">Complete at least two attempts to see a trend.</p>}
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full" role="img" aria-label={`Score percentage across ${pts.length} attempts: ${pts.map((p) => Math.round(p.pct) + '%').join(', ')}`}>
          {[0, 50, 100].map((g) => <g key={g}><line x1={pad} x2={W - pad / 2} y1={y(g)} y2={y(g)} stroke="rgb(var(--paper-edge))" /><text x={pad - 8} y={y(g) + 4} textAnchor="end" className="fill-muted" style={{ font: '11px "JetBrains Mono", monospace' }}>{g}%</text></g>)}
          {pts.length > 1 && <polyline points={pts.map((p, i) => `${x(i)},${y(p.pct)}`).join(' ')} fill="none" stroke="rgb(var(--signal))" strokeWidth="2.5" strokeLinejoin="round" />}
          {pts.map((p, i) => <g key={p.id}><circle cx={x(i)} cy={y(p.pct)} r="5" fill={p.expired ? 'rgb(var(--gold))' : 'rgb(var(--signal))'} stroke="white" strokeWidth="2" /><text x={x(i)} y={y(p.pct) - 11} textAnchor="middle" className="fill-ink" style={{ font: '600 11px "JetBrains Mono", monospace' }}>{Math.round(p.pct)}%</text></g>)}
        </svg>
        {pts.some((p) => p.expired) && <p className="mt-2 text-xs text-muted">Gold dots are attempts where time expired.</p>}
      </Card>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-xl font-semibold">Accuracy by skill</h2>
          {skills.length === 0 ? <p className="mt-3 text-sm text-muted">We show a skill once you’ve answered at least 3 questions on it.</p> : (
            <div className="mt-5 space-y-4">{skills.map(([k, s]) => <div key={k}><div className="mb-1.5 flex justify-between text-sm font-medium"><span>{SKILL_LABELS[k]}</span><span className="tabular text-muted">{s.correct}/{s.total}</span></div><Meter value={s.correct} max={s.total} label={SKILL_LABELS[k]} tone={s.correct / s.total < 0.5 ? 'warn' : 'signal'} /></div>)}</div>
          )}
        </Card>
        <Card className="p-6">
          <h2 className="text-xl font-semibold">Practice, last 14 days</h2>
          <div className="mt-5 flex h-28 items-end gap-1.5" role="img" aria-label={`Questions answered per day for 14 days: ${days.map((d) => d.questions).join(', ')}`}>
            {days.map((d) => <div key={d.day} className="flex-1 rounded-t bg-signal/80" title={`${d.day}: ${d.questions} questions`} style={{ height: `${Math.max(d.questions ? 8 : 2, (d.questions / maxQ) * 100)}%`, opacity: d.questions ? 1 : 0.25 }} />)}
          </div>
          <p className="mt-3 text-xs text-muted">Only completed practice counts.</p>
        </Card>
      </div>

      <Card className="mt-5 p-6">
        <h2 className="text-xl font-semibold">Review &amp; retry</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
          {[['In vault', vault.length], ['Mastered', vault.filter((v) => v.status === 'mastered').length], ['Times reviewed', vault.reduce((a, v) => a + v.reviewCount, 0)], ['Practice answers', retried]].map(([l, v]) => <div key={l as string} className="rounded-xl bg-paper p-3"><dt className="text-xs text-muted">{l as string}</dt><dd className="font-mono text-2xl font-semibold tabular">{v as number}</dd></div>)}
        </dl>
      </Card>
      <Notice tone="info" className="mt-5">Practice trends show how you’re doing on these particular questions. They don’t predict a real exam result or your CEFR level.</Notice>
    </div>
  );
}
