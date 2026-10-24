import { ArrowRight, BookOpenText, Headphones, Mic, PenLine, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SampleCard } from '@/components/SampleCard';
import { LoopDiagram } from '@/components/LoopDiagram';
import { Badge, Eyebrow, LinkButton, buttonClass } from '@/components/ui/ui';
import { useDocumentTitle } from '@/lib/hooks';

const skills = [
  { Icon: BookOpenText, name: 'Reading', status: 'Available now', live: true, text: 'Timed mini-mocks with passages, seven question formats, server-style scoring and full explanations.' },
  { Icon: Headphones, name: 'Listening', status: 'In development', live: false, text: 'Original recordings with segment-linked questions and transcripts after you submit.' },
  { Icon: PenLine, name: 'Writing', status: 'In development', live: false, text: 'Task 1- and Task 2-style prompts with a structured rubric for self-review.' },
  { Icon: Mic, name: 'Speaking', status: 'In development', live: false, text: 'Part 1–3-style prompts with optional microphone recording, only with your consent.' },
];

export default function Landing() {
  useDocumentTitle('Independent IELTS-style practice');
  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden">
        <div className="grid-dots pointer-events-none absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute -right-40 top-0 h-[34rem] w-[34rem] rounded-full bg-signal/20 blur-3xl" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pb-28 lg:pt-20">
          <div className="animate-rise">
            <Badge tone="dark">Independent IELTS-style practice · Free</Badge>
            <h1 className="mt-6 text-[2.7rem] font-semibold leading-[1.03] sm:text-6xl">
              Practice like it counts.{' '}
              <em className="font-medium not-italic text-gold [font-style:italic]">Learn from every miss.</em>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-mist-2">
              Timed Reading mock exams, a transparent raw-score report, and a private Mistake Vault that turns each wrong answer into your next practice session.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <LinkButton to="/practice" variant="gold" className="px-7 py-3.5 text-base">Start Practicing <ArrowRight className="h-4 w-4" aria-hidden /></LinkButton>
              <Link to="/how-it-works" className={buttonClass('ghost', 'px-6 py-3.5 text-base text-paper ring-1 ring-white/20 hover:bg-white/10')}>Explore How It Works</Link>
            </div>
            <p className="mt-5 text-sm text-mist">No payment, no premium tier. A free account lets you sit a full mock; the sample on this page needs no sign-up.</p>
          </div>
          <div className="animate-rise [animation-delay:120ms]"><SampleCard tilt /></div>
        </div>
      </section>

      {/* ------------------------------------------------------------ skills */}
      <section className="border-y border-white/10 bg-ink-2/60">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <Eyebrow dark>Four skills · honest status</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold sm:text-4xl">Reading is live. The rest are on the way — and labelled that way.</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {skills.map(({ Icon, name, status, live, text }) => (
              <article key={name} className={`rounded-sheet border p-5 ${live ? 'border-gold/50 bg-ink-3/60' : 'border-white/10 bg-ink-2'}`}>
                <div className="flex items-center justify-between">
                  <Icon className={`h-6 w-6 ${live ? 'text-gold' : 'text-mist'}`} aria-hidden />
                  <span className={`rounded-chip px-2.5 py-0.5 text-xs font-semibold ${live ? 'bg-gold text-ink' : 'bg-white/10 text-mist-2'}`}>{status}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold">{name}</h3>
                <p className="mt-2 text-sm text-mist-2">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ loop */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 lg:grid-cols-2">
        <div>
          <Eyebrow dark>The Exam-to-Mastery loop</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">A mock exam should be the start of studying, not the end.</h2>
          <ol className="mt-8 space-y-5">
            {[
              ['Sit a realistic mock', 'A calm, timed exam screen. The deadline is set by the server, answers autosave, and a refresh never loses your work.'],
              ['Read an honest report', 'Raw marks, section and skill breakdowns, and a reason for every answer. No invented precision.'],
              ['Keep what you missed', 'Wrong and “unsure” answers can go into a private vault. Opening an explanation never counts as mastery.'],
              ['Practice something new', 'Fresh questions chosen by simple, explainable rules — each one comes with the reason it was picked.'],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold font-mono text-sm font-semibold text-ink">{i + 1}</span>
                <div><h3 className="text-lg font-semibold">{t}</h3><p className="mt-1 text-mist-2">{d}</p></div>
              </li>
            ))}
          </ol>
        </div>
        <LoopDiagram />
      </section>

      {/* ------------------------------------------------------------ report preview */}
      <section className="bg-paper text-ink">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Eyebrow>What a report looks like</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">Transparent by design.</h2>
            <p className="mt-4 text-muted">Every result shows the marks, the marking basis, and the explanation behind each answer. Short mini-mocks don’t get a band score, because a few dozen questions can’t support one.</p>
            <ul className="mt-6 space-y-3 text-sm">
              {['Raw marks, with partial credit only where a rule says so', 'Per-question review with your answer, the key and a reason', 'A clear note when time ran out — never disguised as a normal submission'].map((t) => (
                <li key={t} className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-signal-deep" aria-hidden />{t}</li>
              ))}
            </ul>
          </div>
          <div className="relative rounded-sheet border border-paper-edge bg-white p-6 shadow-sheet" aria-label="Demonstration report">
            <span className="absolute -top-3 left-5 rounded-chip bg-ink px-3 py-1 font-mono text-[0.68rem] font-semibold uppercase tracking-wider text-gold">Demonstration data — not a real learner</span>
            <div className="flex items-end justify-between gap-4 border-b border-paper-edge pb-5 pt-2">
              <div>
                <p className="text-sm text-muted">Reading Mini-Mock · practice marks</p>
                <p className="font-display text-6xl font-semibold tabular">14<span className="text-3xl text-muted">/20</span></p>
              </div>
              <div className="text-right text-sm"><p><b className="text-ok">14</b> correct</p><p><b className="text-bad">4</b> incorrect</p><p><b className="text-muted">2</b> unanswered</p></div>
            </div>
            <div className="space-y-4 py-5">
              {[['Passage 1', 8, 10], ['Passage 2', 6, 10]].map(([n, v, m]) => (
                <div key={n as string}>
                  <div className="mb-1.5 flex justify-between text-sm font-medium"><span>{n}</span><span className="tabular text-muted">{v}/{m}</span></div>
                  <div className="h-2.5 rounded-full bg-ink/10"><div className="h-full rounded-full bg-signal" style={{ width: `${((v as number) / (m as number)) * 100}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-signal-soft/60 p-4 text-sm">
              <p className="font-semibold text-signal-deep">Why you’ll see this recommendation</p>
              <p className="mt-1 text-ink-3">You answered 3 of 5 “True / False / Not Given” questions incorrectly so far — a small sample, so treat it as a starting point.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ free + CTA */}
      <section className="mx-auto max-w-4xl px-5 py-24 text-center">
        <h2 className="text-3xl font-semibold sm:text-5xl">Free means free.</h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-mist-2">There’s no payment, subscription, paywall or usage cap. You’ll need an account so your attempts, answers and mistakes can be saved privately to you.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <LinkButton to="/practice" variant="gold" className="px-7 py-3.5 text-base">Browse the catalogue</LinkButton>
          <LinkButton to="/sample" variant="ghost" className="px-6 py-3.5 text-base text-paper ring-1 ring-white/20 hover:bg-white/10">Try the sample</LinkButton>
        </div>
        <p className="mx-auto mt-10 max-w-xl text-xs text-mist">Fluent is an independent practice tool, not affiliated with or endorsed by IELTS or any exam provider. Practice marks are estimates and are not official, validated or accepted for admissions.</p>
      </section>
    </>
  );
}
