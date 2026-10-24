import { ArrowRight, BookMarked, Flame, Play, Sparkles, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SKILL_LABELS, DAILY_GOAL_QUESTIONS, currentStreak, isDue, questionsToday, type SkillTag } from '@/engine';
import { Badge, Card, EmptyState, ErrorState, LinkButton, Meter, Spinner } from '@/components/ui/ui';
import { useAuth } from '@/lib/auth-context';
import { useServices } from '@/lib/services-context';
import { formatDate, tzOffsetMinutes, useAsync, useDocumentTitle } from '@/lib/hooks';

function GoalRing({ value, max }: { value: number; max: number }) {
  const r = 34, c = 2 * Math.PI * r, pct = Math.min(1, value / max);
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`${Math.min(value, max)} of ${max} questions today`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="rgb(var(--ink) / .1)" strokeWidth="9" />
      <circle cx="44" cy="44" r={r} fill="none" stroke="rgb(var(--signal))" strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 44 44)" />
      <text x="44" y="50" textAnchor="middle" className="fill-ink" style={{ font: '600 20px "JetBrains Mono", monospace' }}>{Math.min(value, max)}</text>
    </svg>
  );
}

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const { user } = useAuth(); const { assessments } = useServices();
  const { data, error, loading, reload } = useAsync(async () => {
    const [results, attempts, vault, recs, activity, tests] = await Promise.all([
      assessments.listResults(), assessments.listAttempts(), assessments.listVault(), assessments.getRecommendations(), assessments.getActivity(), assessments.listTests(),
    ]);
    return { results, attempts, vault, recs, activity, tests };
  }, [assessments]);

  if (loading) return <Spinner label="Loading your dashboard" />;
  if (error || !data) return <ErrorState message={error ?? 'Unknown error'} onRetry={reload} />;

  const now = new Date(); const tz = tzOffsetMinutes();
  const { results, attempts, vault, recs, activity, tests } = data;
  const open = attempts.find((a) => a.status === 'in_progress' && a.deadlineAt && Date.parse(a.deadlineAt) > now.getTime());
  const due = vault.filter((v) => isDue(v, now));
  const streak = currentStreak(activity, now, tz), today = questionsToday(activity, now, tz);
  const first = user?.displayName.split(' ')[0] ?? 'there';
  const hour = now.getHours(); const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const testById = new Map(tests.map((t) => [t.id, t]));

  // aggregate skill performance across every report
  const agg = new Map<SkillTag, { a: number; m: number; n: number }>();
  for (const r of results) for (const s of r.score.skillScores) { const c = agg.get(s.skill) ?? { a: 0, m: 0, n: 0 }; c.a += s.awarded; c.m += s.max; c.n += s.questions; agg.set(s.skill, c); }
  const skills = [...agg].filter(([, v]) => v.n >= 2).sort((a, b) => a[1].a / a[1].m - b[1].a / b[1].m);

  // the single best next step
  let next: { title: string; body: string; to: string; cta: string; icon: typeof Play };
  if (open) next = { title: 'Continue your attempt', body: 'Your saved answers are waiting and the clock is still running.', to: `/attempts/${open.id}`, cta: 'Resume exam', icon: Play };
  else if (due.length) next = { title: `Review ${due.length} mistake${due.length > 1 ? 's' : ''}`, body: 'These are due for another look, based on your review schedule.', to: '/mistake-vault', cta: 'Open Mistake Vault', icon: BookMarked };
  else if (recs.length) next = { title: `Practice: ${SKILL_LABELS[recs[0].skill]}`, body: recs[0].reason, to: '/practice/recommended', cta: 'See recommendations', icon: Sparkles };
  else if (results.length === 0) next = { title: 'Take your first mock exam', body: 'A short, timed Reading mini-mock. Your report will show where to focus next.', to: `/tests/${tests[0]?.slug ?? ''}`, cta: 'Start the mini-mock', icon: Play };
  else next = { title: 'Sit another mock', body: 'Fresh attempts let you measure whether practice is paying off.', to: '/practice', cta: 'Browse tests', icon: Play };
  const NextIcon = next.icon;

  return (
    <div>
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-signal-deep">{greet}</p>
      <h1 className="mt-1 text-4xl font-semibold">Welcome back, {first}.</h1>
      <p className="mt-2 text-muted">{results.length === 0 ? 'Let’s get your first report in.' : 'A little practice each day beats a long session once in a while.'}</p>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <section className="on-dark relative overflow-hidden rounded-sheet bg-ink p-7 text-paper shadow-sheet" aria-labelledby="next-h">
          <div className="grid-dots absolute inset-0 opacity-70" aria-hidden />
          <div className="relative">
            <Badge tone="gold">Recommended next step</Badge>
            <h2 id="next-h" className="mt-4 text-3xl font-semibold">{next.title}</h2>
            <p className="mt-2 max-w-md text-mist-2">{next.body}</p>
            <LinkButton to={next.to} variant="gold" className="mt-6"><NextIcon className="h-4 w-4" aria-hidden />{next.cta}<ArrowRight className="h-4 w-4" aria-hidden /></LinkButton>
          </div>
        </section>
        <div className="grid grid-cols-2 gap-5 lg:grid-cols-1">
          <Card className="flex items-center gap-4 p-5">
            <GoalRing value={today} max={DAILY_GOAL_QUESTIONS} />
            <div><p className="flex items-center gap-1.5 text-sm font-semibold"><Target className="h-4 w-4 text-signal-deep" aria-hidden />Daily goal</p><p className="mt-1 text-sm text-muted">{today >= DAILY_GOAL_QUESTIONS ? 'Goal reached — nice.' : `${DAILY_GOAL_QUESTIONS - today} more question${DAILY_GOAL_QUESTIONS - today === 1 ? '' : 's'} today.`}</p></div>
          </Card>
          <Card className="p-5">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Flame className="h-4 w-4 text-warn" aria-hidden />Practice streak</p>
            <p className="mt-1 font-display text-4xl font-semibold tabular">{streak} <span className="text-base font-sans font-medium text-muted">{streak === 1 ? 'day' : 'days'}</span></p>
            <p className="mt-1 text-xs text-muted">{streak === 0 ? 'Complete a mock or practice set to start one.' : 'Counts days with completed practice only.'}</p>
          </Card>
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Recent attempts</h2><Link to="/history" className="text-sm font-semibold text-signal-deep underline">All</Link></div>
          {results.length === 0 ? <p className="mt-4 text-sm text-muted">No completed attempts yet. Your first report will appear here.</p> : (
            <ul className="mt-4 divide-y divide-paper-edge">
              {results.slice(0, 4).map((r) => (
                <li key={r.attemptId}>
                  <Link to={`/results/${r.attemptId}`} className="flex items-center justify-between gap-3 py-3 hover:text-signal-deep">
                    <span><span className="block text-sm font-semibold">{testById.get(r.testId)?.title ?? r.testTitle}</span><span className="text-xs text-muted">{formatDate(r.submittedAt)}{r.submissionKind === 'time_expired' && ' · time expired'}</span></span>
                    <span className="font-mono text-lg font-semibold tabular">{r.score.rawScore}<span className="text-sm text-muted">/{r.score.maxScore}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-6">
          <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Mistake Vault</h2><Link to="/mistake-vault" className="text-sm font-semibold text-signal-deep underline">Open</Link></div>
          {vault.length === 0 ? <p className="mt-4 text-sm text-muted">Nothing saved yet. After a report, save missed or unsure questions here to revisit them.</p> : (
            <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
              {[['Due', due.length], ['Learning', vault.filter((v) => v.status !== 'mastered').length], ['Mastered', vault.filter((v) => v.status === 'mastered').length]].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-paper p-3"><dt className="text-xs text-muted">{l as string}</dt><dd className="font-mono text-2xl font-semibold tabular">{v as number}</dd></div>
              ))}
            </dl>
          )}
        </Card>
      </div>

      <Card className="mt-5 p-6">
        <h2 className="text-xl font-semibold">Skill progress</h2>
        {skills.length === 0 ? (
          <div className="mt-4"><EmptyState icon={<Sparkles />} title="Skill insight appears after your first report">We only show a skill once there are enough questions behind it.</EmptyState></div>
        ) : (
          <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
            {skills.map(([k, v]) => <div key={k}><div className="mb-1.5 flex justify-between text-sm font-medium"><span>{SKILL_LABELS[k]}</span><span className="tabular text-muted">{Math.round((v.a / v.m) * 100)}%</span></div><Meter value={v.a} max={v.m} label={SKILL_LABELS[k]} tone={v.a / v.m < 0.5 ? 'warn' : 'signal'} /></div>)}
          </div>
        )}
        <p className="mt-5 text-xs text-muted">Practice estimates from your own answers — not a validated proficiency level.</p>
      </Card>
    </div>
  );
}
