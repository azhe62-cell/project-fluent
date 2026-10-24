import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AutosaveQueue, crossedAnnouncement, remainingMs, spokenRemaining, syncClock,
  type AnswerValue, type ClockSync, type ResponseDraft, type SaveStatus, type SubmissionKind,
} from '@/engine';
import { useServices } from '@/lib/services-context';
import { ServiceError, type AttemptSession } from '@/services/types';

export type SubmitState = 'idle' | 'submitting' | 'error';

const blank = (questionId: string): ResponseDraft => ({ questionId, answer: null, flagged: false, unsure: false, seq: 0 });

/**
 * Drives a live attempt. The SERVER owns the deadline and the saved state; this hook only
 * displays a countdown derived from server timestamps, saves through a debounced queue,
 * and re-syncs when the tab regains focus or the network returns.
 */
export function useAttemptRunner(attemptId: string) {
  const { assessments } = useServices();
  const navigate = useNavigate();

  const [session, setSession] = useState<AttemptSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, ResponseDraft>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveDetail, setSaveDetail] = useState<string | undefined>();
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [canForce, setCanForce] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [expiring, setExpiring] = useState(false);

  const seq = useRef(0);
  const sync = useRef<ClockSync>({ offsetMs: 0 });
  const queue = useRef<AutosaveQueue | null>(null);
  const finishing = useRef(false);
  const lastRemaining = useRef<number | null>(null);
  const wasFailed = useRef(false);

  const goToResults = useCallback(() => navigate(`/results/${attemptId}`, { replace: true }), [navigate, attemptId]);

  // ---- load
  useEffect(() => {
    let alive = true;
    assessments.getAttempt(attemptId).then((s) => {
      if (!alive) return;
      if (!s) { setLoadError('We couldn’t find that attempt. It may belong to another account.'); return; }
      if (s.attempt.status !== 'in_progress') { goToResults(); return; }
      seq.current = Math.max(0, ...Object.values(s.responses).map((r) => r.seq));
      sync.current = syncClock(s.serverNow, Date.now());
      setResponses(s.responses); setSession(s);
    }).catch((e) => alive && setLoadError(e instanceof Error ? e.message : 'Could not load the attempt.'));
    return () => { alive = false; };
  }, [assessments, attemptId, goToResults]);

  // ---- autosave queue
  useEffect(() => {
    if (!session) return;
    const q = new AutosaveQueue({
      save: async (batch) => {
        const r = await assessments.saveResponses(attemptId, batch);
        sync.current = syncClock(r.serverNow, Date.now());
        return r.fatal ? { fatal: r.fatal } : {};
      },
      onStatus: (s, d) => {
        setSaveStatus(s); setSaveDetail(d);
        if (s === 'failed') { wasFailed.current = true; setAnnouncement('Saving failed. Your latest answers are not saved yet. Retrying.'); }
        if (s === 'saved' && wasFailed.current) { wasFailed.current = false; setAnnouncement('Connection restored. All answers saved.'); }
      },
    });
    queue.current = q;
    return () => q.dispose();
  }, [session, assessments, attemptId]);

  // ---- finishing (learner submit, or timer expiry)
  const submit = useCallback(async (kind: SubmissionKind, opts: { force?: boolean } = {}) => {
    if (finishing.current && kind === 'learner_submitted') return;
    finishing.current = true;
    setSubmitState('submitting'); setSubmitError(null);
    const saved = await (queue.current?.flush() ?? Promise.resolve(true));
    if (!saved && kind === 'learner_submitted' && !opts.force) {
      finishing.current = false; setSubmitState('error'); setCanForce(true);
      setSubmitError('Some of your latest answers couldn’t be saved. Check your connection and try again — or submit anyway, in which case those answers will be lost.');
      return;
    }
    try {
      await assessments.submitAttempt(attemptId, kind);   // only navigate once the server has confirmed
      goToResults();
    } catch (e) {
      finishing.current = false; setSubmitState('error');
      setSubmitError(e instanceof ServiceError ? e.message : 'We couldn’t reach the server. Nothing was lost — your answers are saved. Please try again.');
    }
  }, [assessments, attemptId, goToResults]);

  // ---- countdown (display only)
  useEffect(() => {
    if (!session?.attempt.deadlineAt) return;
    const deadline = session.attempt.deadlineAt;
    const tick = () => {
      const secs = Math.ceil(remainingMs(deadline, sync.current, Date.now()) / 1000);
      const prev = lastRemaining.current;
      if (secs !== prev) {
        lastRemaining.current = secs; setRemaining(secs);
        if (prev !== null) { const t = crossedAnnouncement(prev, secs); if (t) setAnnouncement(spokenRemaining(secs)); }
      }
      if (secs <= 0 && !finishing.current) { setExpiring(true); void submit('time_expired'); }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [session, submit]);

  // ---- re-sync on focus / visibility / reconnect; warn before leaving with unsaved work
  useEffect(() => {
    if (!session) return;
    const resync = async () => {
      if (document.visibilityState === 'hidden') return;
      void queue.current?.flush();
      try {
        const s = await assessments.getAttempt(attemptId);
        if (!s) return;
        if (s.attempt.status !== 'in_progress') { goToResults(); return; }
        sync.current = syncClock(s.serverNow, Date.now());
      } catch { /* offline: keep the last known offset */ }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => { if (queue.current?.hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync); window.addEventListener('online', resync);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync); window.removeEventListener('online', resync);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [session, assessments, attemptId, goToResults]);

  // ---- learner actions
  const update = useCallback((questionId: string, patch: Partial<Pick<ResponseDraft, 'answer' | 'flagged' | 'unsure'>>) => {
    setResponses((cur) => {
      const next: ResponseDraft = { ...(cur[questionId] ?? blank(questionId)), ...patch, seq: ++seq.current };
      queue.current?.enqueue(next);
      return { ...cur, [questionId]: next };
    });
  }, []);

  const setAnswer = useCallback((id: string, answer: AnswerValue) => update(id, { answer }), [update]);
  const toggleFlag = useCallback((id: string) => update(id, { flagged: !(responses[id]?.flagged ?? false) }), [update, responses]);
  const toggleUnsure = useCallback((id: string) => update(id, { unsure: !(responses[id]?.unsure ?? false) }), [update, responses]);

  const retrySave = useCallback(() => { void queue.current?.flush(); }, []);

  const stats = useMemo(() => {
    const qs = session?.test.questions ?? [];
    const isAnswered = (id: string) => { const a = responses[id]?.answer; return Array.isArray(a) ? a.length > 0 : !!a && a.trim() !== ''; };
    return {
      total: qs.length,
      answered: qs.filter((q) => isAnswered(q.id)).length,
      flagged: qs.filter((q) => responses[q.id]?.flagged).length,
      isAnswered,
    };
  }, [session, responses]);

  return {
    session, loadError, responses, remaining, saveStatus, saveDetail, submitState, submitError, canForce,
    announcement, expiring, stats, setAnswer, toggleFlag, toggleUnsure, submit, retrySave,
  };
}
