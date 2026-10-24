import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Clock, ListChecks, PlayCircle, Save } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Notice, Spinner, EmptyState } from '@/components/ui/ui';
import { useServices } from '@/lib/services-context';
import { formatDateTime, useAsync, useDocumentTitle } from '@/lib/hooks';
import { TYPE_LABELS, type QuestionType } from '@/engine';

export default function TestOverview() {
  const { testId: slug = '' } = useParams();
  const { assessments } = useServices();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(async () => {
    const test = await assessments.getTest(slug);
    const attempts = test ? (await assessments.listAttempts()).filter((a) => a.testId === test.id) : [];
    return { test, attempts };
  }, [slug, assessments]);
  const [ready, setReady] = useState({ quiet: false, time: false, rules: false });
  const [busy, setBusy] = useState(false); const [startErr, setStartErr] = useState<string | null>(null);
  useDocumentTitle(data?.test?.title ?? 'Test');

  if (loading) return <Spinner label="Loading test" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data?.test) return <EmptyState title="Test not found" action={<Link to="/practice" className="font-semibold text-signal-deep underline">Back to the catalogue</Link>}>It may have been unpublished or the link is wrong.</EmptyState>;

  const { test, attempts } = data;
  const open = attempts.find((a) => a.status === 'in_progress' && a.deadlineAt && Date.parse(a.deadlineAt) > Date.now());
  const allReady = ready.quiet && ready.time && ready.rules;
  const types = [...new Set(test.questions.map((q) => q.type))] as QuestionType[];

  const start = async () => {
    setBusy(true); setStartErr(null);
    try { const s = await assessments.startOrResumeAttempt(test.id); navigate(`/attempts/${s.attempt.id}`); }
    catch (e) { setStartErr(e instanceof Error ? e.message : 'Could not start the test.'); setBusy(false); }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <Badge tone="signal">Reading · version {test.version}</Badge>
        <h1 className="mt-3 text-4xl font-semibold">{test.title}</h1>
        <p className="mt-3 text-muted">{test.description}</p>

        <dl className="mt-6 grid grid-cols-3 gap-3">
          {[[Clock, 'Time limit', `${test.durationSeconds / 60} min`], [ListChecks, 'Questions', String(test.questions.length)], [CheckCircle2, 'Marks', String(test.questions.reduce((a, q) => a + q.marks, 0))]].map(([I, l, v]) => {
            const Icon = I as typeof Clock;
            return <div key={l as string} className="rounded-xl border border-paper-edge bg-white p-4"><dt className="flex items-center gap-1.5 text-xs text-muted"><Icon className="h-3.5 w-3.5" aria-hidden />{l as string}</dt><dd className="mt-1 text-xl font-semibold tabular">{v as string}</dd></div>;
          })}
        </dl>

        <h2 className="mt-10 text-2xl font-semibold">Instructions</h2>
        <ul className="mt-3 space-y-2.5 text-[0.95rem] text-ink-3">
          <li className="flex gap-3"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-signal-deep" aria-hidden /><span>The timer starts when you press <b>Start</b>. The deadline is set by the server — reloading or leaving the page doesn’t pause it.</span></li>
          <li className="flex gap-3"><Save className="mt-0.5 h-5 w-5 shrink-0 text-signal-deep" aria-hidden /><span>Answers autosave. If you reload, you’ll return to the same attempt with your saved answers.</span></li>
          <li className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-signal-deep" aria-hidden /><span>You can change answers until you submit. Unanswered questions score zero; there’s no negative marking.</span></li>
        </ul>
        <h3 className="mt-6 text-sm font-semibold">Question types in this test</h3>
        <p className="mt-2 flex flex-wrap gap-2">{types.map((t) => <Badge key={t}>{TYPE_LABELS[t]}</Badge>)}</p>
        <Notice tone="info" className="mt-6" title="About the score">{test.scoringNote} Fluent is independent and not affiliated with any exam provider.</Notice>
      </div>

      <aside className="lg:sticky lg:top-8 lg:self-start">
        <Card className="p-6">
          {open ? (
            <>
              <h2 className="text-xl font-semibold">You have an attempt in progress</h2>
              <p className="mt-2 text-sm text-muted">Started {formatDateTime(open.startedAt!)}. Your saved answers are waiting.</p>
              <Button className="mt-5 w-full" onClick={() => navigate(`/attempts/${open.id}`)}><PlayCircle className="h-4 w-4" aria-hidden />Continue attempt</Button>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">Readiness check</h2>
              <p className="mt-1 text-sm text-muted">Three quick confirmations before the clock starts.</p>
              <div className="mt-4 space-y-3">
                {([['quiet', 'I’m somewhere I can concentrate.'], ['time', `I can spend ${test.durationSeconds / 60} uninterrupted minutes now.`], ['rules', 'I understand the timer won’t pause once I start.']] as const).map(([k, l]) => (
                  <label key={k} className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-signal" checked={ready[k]} onChange={(e) => setReady({ ...ready, [k]: e.target.checked })} />{l}</label>
                ))}
              </div>
              {startErr && <Notice tone="bad" className="mt-4">{startErr}</Notice>}
              <Button className="mt-5 w-full" disabled={!allReady} loading={busy} onClick={start}><PlayCircle className="h-4 w-4" aria-hidden />Start the test</Button>
            </>
          )}
        </Card>
        {attempts.length > 0 && (
          <Card className="mt-4 p-5">
            <h3 className="text-sm font-semibold">Your previous attempts</h3>
            <ul className="mt-3 divide-y divide-paper-edge text-sm">
              {attempts.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <span className="text-muted">{formatDateTime(a.createdAt)}</span>
                  <Link className="font-semibold text-signal-deep underline" to={a.status === 'in_progress' ? `/attempts/${a.id}` : `/results/${a.id}`}>{a.status === 'in_progress' ? 'Resume' : 'Report'}</Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}
