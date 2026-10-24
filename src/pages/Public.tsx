import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Clock, FileText, Headphones, Mic, PenLine } from 'lucide-react';
import { SampleCard } from '@/components/SampleCard';
import { Badge, Card, EmptyState, ErrorState, Eyebrow, LinkButton, Notice, Spinner } from '@/components/ui/ui';
import { useServices } from '@/lib/services-context';
import { useAsync, useDocumentTitle } from '@/lib/hooks';

const Wrap = ({ children, narrow = true }: { children: ReactNode; narrow?: boolean }) => (
  <div className={`mx-auto px-5 py-14 sm:py-20 ${narrow ? 'max-w-3xl' : 'max-w-5xl'}`}>{children}</div>
);
const H2 = ({ children }: { children: ReactNode }) => <h2 className="mb-3 mt-12 text-2xl font-semibold">{children}</h2>;
const P = ({ children }: { children: ReactNode }) => <p className="mt-3 leading-relaxed text-ink-3">{children}</p>;
const UL = ({ items }: { items: ReactNode[] }) => (
  <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-3 marker:text-signal">{items.map((i, k) => <li key={k}>{i}</li>)}</ul>
);

export function HowItWorks() {
  useDocumentTitle('How it works');
  return (
    <Wrap>
      <Eyebrow>How it works</Eyebrow>
      <h1 className="mt-2 text-4xl font-semibold sm:text-5xl">From mock exam to mastery</h1>
      <P>Fluent is built around one loop: take a realistic exam, understand the result, keep what you missed, and practice something new that targets it.</P>

      <H2>1 · The exam</H2>
      <P>You need a free account to start a full assessment, so your progress can be saved to you alone. When you start, the server stamps the start time and sets the deadline. The countdown you see is only a display of that deadline — refreshing the page or switching tabs can’t buy extra time or lose it.</P>
      <UL items={[
        'Answers autosave and show Saving, Saved or Save failed — failed saves retry automatically.',
        'A question navigator shows answered, unanswered and flagged questions (with icons, not just colour).',
        'Submission is confirmed by the server before you’re told it worked, and pressing Submit twice never creates a second result.',
        'If time runs out, the attempt is recorded as expired and scored only on answers saved before the deadline. The report says so clearly.',
      ]} />

      <H2>2 · The report</H2>
      <P>Reports show raw practice marks and what each mark was based on, plus a section and skill breakdown and a question-by-question review with explanations. Partial credit exists only where a documented rule says so (for example, “choose two” questions: one mark per correct choice, no negative marking).</P>
      <Notice tone="info" title="No band scores for mini-mocks" className="mt-4">A short mock can’t support a reliable IELTS-style band. Until a full-length format has a documented conversion table, Fluent shows raw marks only.</Notice>

      <H2>3 · The Mistake Vault</H2>
      <P>Incorrect, partial, unanswered and “unsure” answers can be saved to a private vault (once each — no duplicates). Reading an explanation changes nothing. An item becomes <em>mastered</em> only after you answer it correctly twice in a row <strong>and</strong> get at least one fresh, related question right. You can mark something “needs more practice”, but you can’t self-declare mastery.</P>

      <H2>4 · Targeted practice</H2>
      <P>Recommendations come from plain rules, not a black box: find the skills where your accuracy is lowest (with enough answers to say anything), pick mostly questions you haven’t seen, add one you previously missed, and explain why. With small samples we say so.</P>

      <div className="mt-12 flex flex-wrap gap-3"><LinkButton to="/practice">Browse practice tests <ArrowRight className="h-4 w-4" aria-hidden /></LinkButton><LinkButton to="/sample" variant="secondary">Try the sample</LinkButton></div>
    </Wrap>
  );
}

export function PracticeCatalogue() {
  useDocumentTitle('Practice catalogue');
  const { assessments } = useServices();
  const { data, error, loading, reload } = useAsync(() => assessments.listTests(), [assessments]);
  return (
    <Wrap narrow={false}>
      <Eyebrow>Practice catalogue</Eyebrow>
      <h1 className="mt-2 text-4xl font-semibold sm:text-5xl">Choose a practice test</h1>
      <p className="mt-3 max-w-2xl text-muted">Original, IELTS-style practice. Browse freely; you’ll be asked to sign in or create a free account when you start one.</p>
      <div className="mt-10">
        {loading && <Spinner label="Loading tests" />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {data && data.length === 0 && <EmptyState icon={<FileText />} title="No published tests yet">New practice tests will appear here once they’re reviewed and published.</EmptyState>}
        {data && data.length > 0 && (
          <ul className="grid gap-5 sm:grid-cols-2">
            {data.map((t) => (
              <li key={t.id}>
                <Card as="article" className="flex h-full flex-col p-6">
                  <div className="flex items-center justify-between"><Badge tone="signal">Reading</Badge><span className="text-xs text-muted">Version {t.version}</span></div>
                  <h2 className="mt-4 text-2xl font-semibold">{t.title}</h2>
                  <p className="mt-2 flex-1 text-sm text-muted">{t.description}</p>
                  <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-paper-edge pt-4 text-center text-sm">
                    <div><dt className="text-xs text-muted">Time</dt><dd className="font-semibold tabular"><Clock className="mr-1 inline h-3.5 w-3.5" aria-hidden />{t.durationSeconds / 60} min</dd></div>
                    <div><dt className="text-xs text-muted">Questions</dt><dd className="font-semibold tabular">{t.questionCount}</dd></div>
                    <div><dt className="text-xs text-muted">Marks</dt><dd className="font-semibold tabular">{t.totalMarks}</dd></div>
                  </dl>
                  <LinkButton to={`/tests/${t.slug}`} className="mt-5">View &amp; start</LinkButton>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
      <h2 className="mt-16 text-2xl font-semibold">Coming next</h2>
      <p className="mt-2 text-sm text-muted">These are in development and not yet available.</p>
      <ul className="mt-5 grid gap-4 sm:grid-cols-3">
        {[[Headphones, 'Listening', 'Original audio with segment-linked questions.'], [PenLine, 'Writing', 'Task 1/2-style prompts with a self-review rubric.'], [Mic, 'Speaking', 'Parts 1–3 with optional, consent-based recording.']].map(([I, n, d]) => {
          const Icon = I as typeof Mic;
          return <li key={n as string} className="rounded-sheet border border-dashed border-ink/20 p-5"><Icon className="h-5 w-5 text-muted" aria-hidden /><p className="mt-3 font-semibold">{n as string}</p><p className="mt-1 text-sm text-muted">{d as string}</p></li>;
        })}
      </ul>
    </Wrap>
  );
}

export function SamplePage() {
  useDocumentTitle('Try a sample');
  return (
    <Wrap>
      <Eyebrow>Sample</Eyebrow>
      <h1 className="mt-2 text-4xl font-semibold">Try two questions</h1>
      <P>This is a public sample — no account needed. It uses two items that are separate from the practice bank, so trying it doesn’t reveal answers to the real tests.</P>
      <div className="mt-8"><SampleCard /></div>
      <div className="mt-8 flex gap-3"><LinkButton to="/practice">See full practice tests</LinkButton></div>
    </Wrap>
  );
}

export function About() {
  useDocumentTitle('About');
  return (
    <Wrap>
      <Eyebrow>About</Eyebrow>
      <h1 className="mt-2 text-4xl font-semibold">An independent practice platform</h1>
      <P>Fluent (a working name) helps English learners prepare for IELTS-style tasks with realistic timed practice and honest reports. All passages, questions, answer keys and explanations are original and written for this project.</P>
      <H2>What we are not</H2>
      <UL items={[
        'Not affiliated with, endorsed by, or connected to IELTS, its owners, or any examination provider.',
        'Not an official test. Practice marks are estimates of performance on these particular questions, not official, validated or admissions-accepted scores.',
        'Not psychometrically validated. Difficulty labels are editorial estimates.',
        'One short test can’t determine your CEFR level or your real exam result.',
      ]} />
      <H2>Status</H2>
      <P>Reading practice is available. Listening, Writing and Speaking are in development and are labelled as such wherever they appear.</P>
    </Wrap>
  );
}

export function Privacy() {
  useDocumentTitle('Privacy');
  return (
    <Wrap>
      <Eyebrow>Privacy</Eyebrow>
      <h1 className="mt-2 text-4xl font-semibold">Privacy policy</h1>
      <Notice tone="warn" title="Operator action required" className="mt-6">This text describes how the software handles data. Before a public launch, the operator must add their legal entity name, contact address and jurisdiction-specific terms, and have this reviewed.</Notice>
      <H2>What is stored</H2>
      <UL items={[
        'Account data: email address, display name, and a password hash handled by the authentication provider (we never see or store plain-text passwords).',
        'Learning data: your attempts, saved answers, results, Mistake Vault entries, practice sessions, and a minimal activity log used for streaks and the daily goal.',
        'We do not ask for identity documents, precise location, or other unnecessary personal data.',
        'No audio is recorded or stored in this version.',
      ]} />
      <H2>What is not done</H2>
      <UL items={['No advertising, no selling of data, and no third-party analytics of your answers.', 'No external AI services are used in this version.']} />
      <H2>Local demo mode</H2>
      <P>If the site is run without a configured backend, everything stays in your browser’s local storage on your device and nothing is sent anywhere.</P>
      <H2>Your control</H2>
      <P>You can delete your account and all associated learning data from Settings. Retention: learning data is kept while your account exists and is deleted with it.</P>
    </Wrap>
  );
}

export function Terms() {
  useDocumentTitle('Terms');
  return (
    <Wrap>
      <Eyebrow>Terms</Eyebrow>
      <h1 className="mt-2 text-4xl font-semibold">Terms of use &amp; educational disclaimer</h1>
      <H2>Free educational use</H2>
      <P>Fluent is free to use for personal study. There are no payments or subscriptions. Please don’t attempt to copy the question bank, bypass rate limits, or access other learners’ data.</P>
      <H2>Educational disclaimer</H2>
      <UL items={[
        'Practice marks and any estimates are for study guidance only.',
        'They are not official scores and don’t predict or guarantee any real exam result.',
        'Fluent is independent and not affiliated with IELTS or any exam provider.',
      ]} />
      <H2>No warranty</H2>
      <P>The service is provided “as is” while in early development. Content may contain errors; please report any you find.</P>
    </Wrap>
  );
}

export function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <Wrap>
      <p className="font-mono text-sm font-semibold text-signal-deep">404</p>
      <h1 className="mt-2 text-4xl font-semibold">We couldn’t find that page</h1>
      <P>The link may be old, or the page may have moved.</P>
      <div className="mt-8 flex gap-3"><LinkButton to="/">Go home</LinkButton><Link to="/practice" className="self-center text-sm font-semibold text-signal-deep underline">Browse tests</Link></div>
    </Wrap>
  );
}
