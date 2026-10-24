import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, CircleDashed, Sparkles, XCircle } from 'lucide-react';
import { SKILL_LABELS, type AnswerValue } from '@/engine';
import { Badge, Button, Card, EmptyState, ErrorState, LinkButton, Notice, PageHeader, Spinner } from '@/components/ui/ui';
import { QuestionBlock } from '@/components/exam/QuestionBlock';
import { useServices } from '@/lib/services-context';
import { FeatureUnavailable } from '@/components/FeatureUnavailable';
import { useAsync, useDocumentTitle } from '@/lib/hooks';

const diffLabel = { 1: 'easier', 2: 'medium', 3: 'harder' } as const;

export function RecommendedPractice() {
  useDocumentTitle('Recommended practice');
  const { assessments } = useServices(); const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(async () => ({ recs: await assessments.getRecommendations(), results: await assessments.listResults() }), [assessments]);
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  if (!assessments.capabilities.practice) return <FeatureUnavailable name="Targeted practice" />;
  if (loading) return <Spinner label="Working out your recommendations" />;
  if (error || !data) return <ErrorState message={error ?? 'Unknown error'} onRetry={reload} />;

  const start = async (skill: (typeof data.recs)[number]) => {
    setBusy(skill.skill); setErr(null);
    try { const s = await assessments.createPracticeSession({ mode: 'recommended', skill: skill.skill, questionIds: skill.questionIds }); navigate(`/practice/session/${s.id}`); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not start.'); setBusy(null); }
  };

  return (
    <div>
      <PageHeader eyebrow="Targeted practice" title="Recommended for you">Chosen by simple rules from your own answers: your weakest skills first, mostly questions you haven’t seen.</PageHeader>
      {err && <Notice tone="bad" className="mb-4">{err}</Notice>}
      {data.recs.length === 0 ? (
        data.results.length === 0
          ? <EmptyState icon={<Sparkles />} title="Take a mock first" action={<LinkButton to="/practice">Browse practice tests</LinkButton>}>Recommendations come from your answers. Once you’ve completed an exam, the weak spots will show up here.</EmptyState>
          : <EmptyState icon={<CheckCircle2 />} title="No clear weak spot right now" action={<LinkButton to="/mistake-vault" variant="secondary">Review your Mistake Vault</LinkButton>}>Either your accuracy is solid in every skill we have enough data on, or we’ve run out of fresh questions for them. Another mock will give us more to go on.</EmptyState>
      ) : (
        <ul className="space-y-5">
          {data.recs.map((r) => (
            <li key={r.skill}>
              <Card as="article" className="p-6">
                <div className="flex flex-wrap items-center gap-2"><Badge tone="signal">{SKILL_LABELS[r.skill]}</Badge><Badge>{Math.round(r.accuracy * 100)}% so far · {r.sampleSize} answers</Badge><Badge>{diffLabel[r.targetDifficulty]} level</Badge></div>
                <p className="mt-4 text-[1.02rem] leading-relaxed"><b>Why this: </b>{r.reason}</p>
                <p className="mt-2 text-sm text-muted">{r.questionIds.length} questions: {r.freshCount} new{r.revisitCount > 0 && `, ${r.revisitCount} to revisit`}.</p>
                <Button className="mt-5" loading={busy === r.skill} onClick={() => start(r)}>Start this session</Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PracticeSession() {
  const { sessionId = '' } = useParams();
  useDocumentTitle('Practice session');
  const { assessments } = useServices();
  const { data, error, loading, reload } = useAsync(() => assessments.getPracticeSession(sessionId), [sessionId, assessments]);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  if (!assessments.capabilities.practice) return <FeatureUnavailable name="Targeted practice" />;
  if (loading) return <Spinner label="Loading session" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <EmptyState title="Session not found" action={<LinkButton to="/practice/recommended" variant="secondary">Back to recommendations</LinkButton>}>It may belong to another account.</EmptyState>;
  const { session, questions, passages } = data;
  const done = session.status === 'completed' && session.grades;

  const submit = async () => {
    setBusy(true); setErr(null);
    try { await assessments.submitPracticeSession(sessionId, answers); reload(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not submit.'); } finally { setBusy(false); }
  };

  const modeLabel = { recommended: 'Targeted practice', vault_retry: 'Retry from your vault', vault_fresh: 'Fresh question on the same concept' }[session.mode];
  const correct = done ? session.grades!.filter((g) => g.outcome === 'correct').length : 0;

  return (
    <div>
      <PageHeader eyebrow={modeLabel} title={session.skill ? SKILL_LABELS[session.skill] : 'Practice'}>Untimed. Take your time and read the passage carefully.</PageHeader>
      {err && <Notice tone="bad" className="mb-4">{err}</Notice>}

      {!done && (
        <div className="space-y-10">
          {passages.map((p) => (
            <section key={p.id} aria-labelledby={`p-${p.id}`}>
              <div className="rounded-sheet border border-paper-edge bg-paper p-6">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-signal-deep">{p.kicker}</p>
                <h2 id={`p-${p.id}`} className="mt-1 text-2xl font-semibold">{p.title}</h2>
                <div className="mt-4 space-y-4">{p.paragraphs.map((x, i) => <p key={i} className="reading-text">{x.label && <b className="mr-2 font-mono text-sm text-signal-deep">{x.label}</b>}{x.text}</p>)}</div>
              </div>
              <div className="mt-4 space-y-3 rounded-sheet border border-paper-edge bg-white p-4 sm:p-5">
                {questions.filter((q) => q.passageId === p.id).map((q, idx) => (
                  <QuestionBlock key={q.id} question={{ ...q, number: idx + 1 }} draft={{ questionId: q.id, answer: answers[q.id] ?? null, flagged: false, unsure: false, seq: 0 }}
                    sharedOptions={q.options} hideControls onAnswer={(a) => setAnswers((cur) => ({ ...cur, [q.id]: a }))} onFlag={() => {}} onUnsure={() => {}} />
                ))}
              </div>
            </section>
          ))}
          <Button onClick={submit} loading={busy} className="px-7 py-3">Check my answers</Button>
        </div>
      )}

      {done && (
        <div className="space-y-5" role="region" aria-label="Practice feedback">
          <Notice tone={correct === session.grades!.length ? 'ok' : 'info'} title={`You got ${correct} of ${session.grades!.length} correct`}>
            {session.mode !== 'recommended' ? 'Your Mistake Vault item has been updated from this graded attempt.' : 'Your answers have been added to your practice record.'}
          </Notice>
          {session.grades!.map((g, i) => (
            <Card key={g.questionId} className="p-5">
              <div className="flex items-center gap-2">
                {g.outcome === 'correct' ? <CheckCircle2 className="h-5 w-5 text-ok" aria-hidden /> : g.outcome === 'unanswered' ? <CircleDashed className="h-5 w-5 text-muted" aria-hidden /> : <XCircle className="h-5 w-5 text-bad" aria-hidden />}
                <span className="font-semibold">{g.outcome === 'correct' ? 'Correct' : g.outcome === 'unanswered' ? 'Unanswered' : 'Not quite'}</span><span className="text-sm text-muted">· Question {i + 1}</span>
              </div>
              <p className="mt-2 font-medium">{g.prompt}</p>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><p className="rounded-xl bg-paper p-3"><b>Your answer:</b> {g.submittedDisplay}</p><p className="rounded-xl bg-ok/10 p-3"><b>Correct:</b> {g.correctDisplay}</p></div>
              <p className="mt-3 text-sm leading-relaxed text-ink-3"><b className="text-ink">Why: </b>{g.explanation}</p>
            </Card>
          ))}
          <div className="flex flex-wrap gap-3"><LinkButton to="/mistake-vault">Mistake Vault</LinkButton><LinkButton to="/practice/recommended" variant="secondary">More recommendations</LinkButton><Link to="/dashboard" className="self-center text-sm font-semibold text-signal-deep underline">Dashboard</Link></div>
        </div>
      )}
    </div>
  );
}
