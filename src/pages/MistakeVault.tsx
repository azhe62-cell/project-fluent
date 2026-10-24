import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookMarked, CalendarClock, CheckCheck, Eye, RotateCcw, Shuffle } from 'lucide-react';
import { MASTERY_STREAK, SKILL_LABELS, filterVault, isDue, type ReviewItem, type SkillTag, type VaultItem, type VaultStatus } from '@/engine';
import { Badge, Button, Card, EmptyState, ErrorState, LinkButton, Notice, PageHeader, Spinner, cn } from '@/components/ui/ui';
import { useServices } from '@/lib/services-context';
import { FeatureUnavailable } from '@/components/FeatureUnavailable';
import { formatDate, useAsync, useDocumentTitle } from '@/lib/hooks';
import { ServiceError } from '@/services/types';

const statusTone = { new: 'signal', learning: 'warn', mastered: 'ok' } as const;
const reasonLabel = { incorrect: 'Answered incorrectly', partial: 'Partly correct', unanswered: 'Left unanswered', unsure: 'Marked unsure' } as const;

export default function MistakeVault() {
  useDocumentTitle('Mistake Vault');
  const { assessments } = useServices(); const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(async () => {
    const [vault, results] = await Promise.all([assessments.listVault(), assessments.listResults()]);
    const review = new Map<string, ReviewItem>();
    for (const r of results) for (const i of r.review) review.set(`${r.attemptId}|${i.questionId}`, i);
    return { vault, review };
  }, [assessments]);
  const [status, setStatus] = useState<VaultStatus | ''>(''); const [skill, setSkill] = useState<SkillTag | ''>('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'info'; text: string } | null>(null);

  const items = useMemo(() => data ? filterVault(data.vault, { status: status || undefined, skill: skill || undefined })
    .sort((a, b) => Number(isDue(b, new Date())) - Number(isDue(a, new Date())) || Date.parse(b.createdAt) - Date.parse(a.createdAt)) : [], [data, status, skill]);

  if (!assessments.capabilities.vault) return <FeatureUnavailable name="The Mistake Vault" />;
  if (loading) return <Spinner label="Opening your vault" />;
  if (error || !data) return <ErrorState message={error ?? 'Unknown error'} onRetry={reload} />;
  const now = new Date();
  const skillsPresent = [...new Set(data.vault.flatMap((v) => v.skillTags))];
  const counts = { due: data.vault.filter((v) => isDue(v, now)).length, learning: data.vault.filter((v) => v.status !== 'mastered').length, mastered: data.vault.filter((v) => v.status === 'mastered').length };

  const start = async (item: VaultItem, mode: 'vault_retry' | 'vault_fresh') => {
    setBusy(item.id + mode); setMsg(null);
    try { const s = await assessments.createPracticeSession({ mode, vaultItemId: item.id }); navigate(`/practice/session/${s.id}`); }
    catch (e) { setMsg({ tone: e instanceof ServiceError && e.code === 'no_fresh_question' ? 'info' : 'bad', text: e instanceof Error ? e.message : 'Could not start practice.' }); }
    finally { setBusy(null); }
  };
  const rate = async (item: VaultItem, rating: 'understood' | 'needs_practice') => {
    setBusy(item.id + rating);
    try { await assessments.selfRateVaultItem(item.id, rating); reload(); } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Could not update.' }); } finally { setBusy(null); }
  };

  return (
    <div>
      <PageHeader eyebrow="Mistake Vault" title="Learn from every miss">A private list of questions to revisit. Only you can see it.</PageHeader>
      <Notice tone="info" title="How mastery works" className="mb-6">Reading an explanation doesn’t count. An item becomes <b>mastered</b> after {MASTERY_STREAK} correct answers in a row, including at least one <b>fresh related question</b>. You can mark “needs more practice” any time, but you can’t declare mastery yourself.</Notice>

      {data.vault.length === 0 ? (
        <EmptyState icon={<BookMarked />} title="Your vault is empty" action={<LinkButton to="/practice">Take a mock exam</LinkButton>}>After a report, save questions you missed or weren’t sure about, and they’ll appear here.</EmptyState>
      ) : (<>
        <dl className="mb-6 grid grid-cols-3 gap-3">
          {[['Due for review', counts.due], ['Still learning', counts.learning], ['Mastered', counts.mastered]].map(([l, v]) => <div key={l as string} className="rounded-xl border border-paper-edge bg-white p-4"><dt className="text-xs text-muted">{l as string}</dt><dd className="font-mono text-3xl font-semibold tabular">{v as number}</dd></div>)}
        </dl>
        <div className="mb-5 flex flex-wrap gap-3">
          <label className="text-sm font-semibold">Status <select className="ml-2 rounded-lg border border-ink/20 bg-white px-3 py-1.5 font-normal" value={status} onChange={(e) => setStatus(e.target.value as VaultStatus | '')}><option value="">All</option><option value="new">New</option><option value="learning">Learning</option><option value="mastered">Mastered</option></select></label>
          <label className="text-sm font-semibold">Skill <select className="ml-2 rounded-lg border border-ink/20 bg-white px-3 py-1.5 font-normal" value={skill} onChange={(e) => setSkill(e.target.value as SkillTag | '')}><option value="">All</option>{skillsPresent.map((s) => <option key={s} value={s}>{SKILL_LABELS[s]}</option>)}</select></label>
        </div>
        {msg && <Notice tone={msg.tone} className="mb-4">{msg.text}</Notice>}
        {items.length === 0 ? <p className="text-sm text-muted" role="status">No items match those filters.</p> : (
          <ul className="space-y-4">
            {items.map((v) => {
              const rv = data.review.get(`${v.sourceAttemptId}|${v.questionId}`);
              const open = revealed.has(v.id); const due = isDue(v, now);
              return (
                <li key={v.id}>
                  <Card as="article" className="p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone[v.status]}>{v.status === 'new' ? 'New' : v.status === 'learning' ? 'Learning' : 'Mastered'}</Badge>
                      <Badge>{reasonLabel[v.reason]}</Badge>
                      {v.skillTags.slice(0, 2).map((s) => <Badge key={s}>{SKILL_LABELS[s]}</Badge>)}
                      {due && <Badge tone="gold" icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden />}>Due now</Badge>}
                    </div>
                    <p className="mt-3 text-[1rem] font-medium">{rv?.prompt ?? 'Question'}</p>
                    <p className="mt-1 text-xs text-muted">Saved {formatDate(v.createdAt)} · reviewed {v.reviewCount}× · streak {v.correctStreak}/{MASTERY_STREAK}{v.freshCorrect > 0 && ' · fresh ✓'}</p>

                    {open && rv && (
                      <div className="mt-4 space-y-3 rounded-xl bg-paper p-4 text-sm">
                        <p><b>Your answer:</b> {rv.submittedDisplay}</p>
                        <p><b className="text-ok">Correct answer:</b> {rv.correctDisplay}</p>
                        <p className="leading-relaxed text-ink-3"><b className="text-ink">Why: </b>{rv.explanation}</p>
                        <p className="text-xs text-muted">Viewing this doesn’t change your progress. Practice does.</p>
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="secondary" className="px-3 py-1.5 text-sm" onClick={() => setRevealed((s) => { const n = new Set(s); n.has(v.id) ? n.delete(v.id) : n.add(v.id); return n; })} aria-expanded={open}><Eye className="h-4 w-4" aria-hidden />{open ? 'Hide explanation' : 'Reveal explanation'}</Button>
                      <Button variant="dark" className="px-3 py-1.5 text-sm" loading={busy === v.id + 'vault_retry'} onClick={() => start(v, 'vault_retry')}><RotateCcw className="h-4 w-4" aria-hidden />Retry this question</Button>
                      <Button className="px-3 py-1.5 text-sm" loading={busy === v.id + 'vault_fresh'} onClick={() => start(v, 'vault_fresh')}><Shuffle className="h-4 w-4" aria-hidden />Practice a fresh one</Button>
                      <Button variant="ghost" className={cn('px-3 py-1.5 text-sm', v.selfRating === 'needs_practice' && 'bg-gold-soft')} loading={busy === v.id + 'needs_practice'} onClick={() => rate(v, 'needs_practice')} aria-pressed={v.selfRating === 'needs_practice'}>Needs more practice</Button>
                      <Button variant="ghost" className={cn('px-3 py-1.5 text-sm', v.selfRating === 'understood' && 'bg-signal-soft')} loading={busy === v.id + 'understood'} onClick={() => rate(v, 'understood')} aria-pressed={v.selfRating === 'understood'}><CheckCheck className="h-4 w-4" aria-hidden />I understand this</Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </>)}
    </div>
  );
}
