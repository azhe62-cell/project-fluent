import { Link } from 'react-router-dom';
import { History as HistoryIcon } from 'lucide-react';
import { Badge, EmptyState, ErrorState, LinkButton, PageHeader, Spinner } from '@/components/ui/ui';
import { useServices } from '@/lib/services-context';
import { formatDateTime, useAsync, useDocumentTitle } from '@/lib/hooks';

export default function HistoryPage() {
  useDocumentTitle('History');
  const { assessments } = useServices();
  const { data, error, loading, reload } = useAsync(async () => {
    const [attempts, results, tests] = await Promise.all([assessments.listAttempts(), assessments.listResults(), assessments.listTests()]);
    return { attempts, results: new Map(results.map((r) => [r.attemptId, r])), tests: new Map(tests.map((t) => [t.id, t])) };
  }, [assessments]);
  if (loading) return <Spinner label="Loading history" />;
  if (error || !data) return <ErrorState message={error ?? 'Unknown error'} onRetry={reload} />;
  return (
    <div>
      <PageHeader eyebrow="History" title="Your attempts">Every attempt, newest first. Expired attempts are marked so they’re never mistaken for on-time submissions.</PageHeader>
      {data.attempts.length === 0 ? (
        <EmptyState icon={<HistoryIcon />} title="No attempts yet" action={<LinkButton to="/practice">Browse practice tests</LinkButton>}>When you take a mock, it will be listed here.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-sheet border border-paper-edge bg-white shadow-sheet">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">Attempt history</caption>
            <thead className="border-b border-paper-edge bg-paper text-xs uppercase tracking-wide text-muted"><tr><th scope="col" className="px-4 py-3">Date</th><th scope="col" className="px-4 py-3">Test</th><th scope="col" className="px-4 py-3">Status</th><th scope="col" className="px-4 py-3 text-right">Marks</th><th scope="col" className="px-4 py-3"><span className="sr-only">Open</span></th></tr></thead>
            <tbody className="divide-y divide-paper-edge">
              {data.attempts.map((a) => {
                const r = data.results.get(a.id);
                const overdue = a.status === 'in_progress' && !!a.deadlineAt && Date.parse(a.deadlineAt) < Date.now();
                const live = a.status === 'in_progress' && !overdue;
                return (
                  <tr key={a.id}>
                    <td className="px-4 py-3 text-muted">{formatDateTime(a.createdAt)}</td>
                    <td className="px-4 py-3 font-medium">{data.tests.get(a.testId)?.title ?? 'Test'}</td>
                    <td className="px-4 py-3">{live ? <Badge tone="signal">In progress</Badge> : overdue || r?.submissionKind === 'time_expired' ? <Badge tone="warn">Time expired</Badge> : <Badge tone="ok">Submitted</Badge>}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular">{r ? `${r.score.rawScore}/${r.score.maxScore}` : '—'}</td>
                    <td className="px-4 py-3 text-right"><Link className="font-semibold text-signal-deep underline" to={live || overdue ? `/attempts/${a.id}` : `/results/${a.id}`}>{live ? 'Resume' : 'Report'}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
