import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { Wordmark } from '@/components/ui/Logo';
import { Button, Field, Notice } from '@/components/ui/ui';
import { safeNext, useAuth } from '@/lib/auth-context';
import { useServices } from '@/lib/services-context';
import { useDocumentTitle } from '@/lib/hooks';
import { ServiceError } from '@/services/types';

function Shell({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }) {
  const { mode } = useServices();
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <aside className="on-dark relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-paper lg:flex">
        <div className="grid-dots absolute inset-0" aria-hidden />
        <Link to="/" className="relative" aria-label="Fluent home"><Wordmark /></Link>
        <div className="relative">
          <p className="font-display text-4xl font-semibold leading-tight">Every wrong answer is <em className="text-gold [font-style:italic]">the next lesson</em>.</p>
          <p className="mt-5 max-w-sm text-mist-2">Independent, free IELTS-style practice with transparent reports. Not affiliated with any exam provider.</p>
        </div>
        <p className="relative text-xs text-mist">Practice marks are estimates, not official results.</p>
      </aside>
      <main id="main" className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 inline-block lg:hidden" aria-label="Fluent home"><Wordmark dark /></Link>
          <h1 className="text-3xl font-semibold">{title}</h1>
          <p className="mt-2 text-muted">{sub}</p>
          {mode === 'local' && (
            <Notice tone="warn" title="Local demo mode" className="mt-6">There is no server, so there are no passwords here. This creates a profile stored only in this browser. Configure Supabase for real accounts.</Notice>
          )}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}

const email = z.string().trim().toLowerCase().email('Enter a valid email address.');
const registerSchema = (needsPassword: boolean) => z.object({
  displayName: z.string().trim().min(2, 'Enter at least 2 characters.').max(60, 'Keep it under 60 characters.'),
  email,
  password: needsPassword ? z.string().min(10, 'Use at least 10 characters.').max(128) : z.string().optional(),
  terms: z.literal(true, { errorMap: () => ({ message: 'Please accept the terms to continue.' }) }),
});

export const authMessage = (e: unknown) => (e instanceof ServiceError ? e.message : 'Something went wrong. Please try again.');

export function Login() {
  useDocumentTitle('Sign in');
  const { auth, mode } = useServices(); const { user } = useAuth();
  const [params] = useSearchParams(); const next = safeNext(params.get('next')); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '' });
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({});
  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const parsed = email.safeParse(form.email);
    const fe = { email: parsed.success ? undefined : parsed.error.issues[0].message, password: mode === 'supabase' && !form.password ? 'Enter your password.' : undefined };
    setFieldErr(fe); if (fe.email || fe.password) return;
    setBusy(true);
    try { await auth.signIn({ email: parsed.data!, password: form.password }); navigate(next, { replace: true }); }
    catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Welcome back" sub={<>New here? <Link className="font-semibold text-signal-deep underline" to={`/auth/register?next=${encodeURIComponent(next)}`}>Create a free account</Link>.</>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {err && <Notice tone="bad" title="Couldn’t sign you in">{err}</Notice>}
        <Field label="Email" type="email" autoComplete="email" value={form.email} error={fieldErr.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        {mode === 'supabase' && <Field label="Password" type="password" autoComplete="current-password" value={form.password} error={fieldErr.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        <Button type="submit" loading={busy} className="w-full">Sign in</Button>
        {mode === 'supabase' && <p className="text-center text-sm"><Link to="/auth/forgot-password" className="font-semibold text-signal-deep underline">Forgot your password?</Link></p>}
      </form>
    </Shell>
  );
}

export function Register() {
  useDocumentTitle('Create account');
  const { auth, mode } = useServices(); const { user } = useAuth();
  const [params] = useSearchParams(); const next = safeNext(params.get('next')); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [verify, setVerify] = useState(false);
  const [form, setForm] = useState({ displayName: '', email: '', password: '', terms: false });
  const [fe, setFe] = useState<Record<string, string>>({});
  if (user && !verify) return <Navigate to={next} replace />;

  if (verify) return (
    <Shell title="Check your email" sub="One more step.">
      <div className="rounded-sheet border border-paper-edge bg-white p-6 text-center shadow-sheet">
        <MailCheck className="mx-auto h-10 w-10 text-signal-deep" aria-hidden />
        <p className="mt-4 font-semibold">We sent a confirmation link to {form.email}.</p>
        <p className="mt-2 text-sm text-muted">Open it to verify your address, then sign in.</p>
        <Link to={`/auth/login?next=${encodeURIComponent(next)}`} className="mt-5 inline-block text-sm font-semibold text-signal-deep underline">Go to sign in</Link>
      </div>
    </Shell>
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const parsed = registerSchema(mode === 'supabase').safeParse(form);
    if (!parsed.success) { setFe(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]))); return; }
    setFe({}); setBusy(true);
    try {
      const r = await auth.signUp({ email: parsed.data.email, password: parsed.data.password, displayName: parsed.data.displayName });
      if (r.needsEmailVerification) setVerify(true); else navigate(next, { replace: true });
    } catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Create your free account" sub={<>Already have one? <Link className="font-semibold text-signal-deep underline" to={`/auth/login?next=${encodeURIComponent(next)}`}>Sign in</Link>.</>}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {err && <Notice tone="bad" title="Couldn’t create the account">{err}</Notice>}
        <Field label="Display name" autoComplete="nickname" value={form.displayName} error={fe.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} error={fe.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        {mode === 'supabase' && <Field label="Password" type="password" autoComplete="new-password" hint="At least 10 characters." value={form.password} error={fe.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        <div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-signal" checked={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.checked })} aria-describedby={fe.terms ? 'terms-err' : undefined} />
            <span>I agree to the <Link to="/terms" className="font-semibold text-signal-deep underline" target="_blank">terms</Link> and understand the <Link to="/privacy" className="font-semibold text-signal-deep underline" target="_blank">privacy policy</Link>. Practice marks are estimates, not official results.</span>
          </label>
          {fe.terms && <p id="terms-err" className="mt-1.5 text-xs font-medium text-bad">{fe.terms}</p>}
        </div>
        <Button type="submit" loading={busy} className="w-full">Create account</Button>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  useDocumentTitle('Reset password');
  const { auth, mode } = useServices();
  const [value, setValue] = useState(''); const [err, setErr] = useState<string | null>(null); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const p = email.safeParse(value); if (!p.success) { setErr(p.error.issues[0].message); return; }
    setBusy(true);
    try { await auth.requestPasswordReset(p.data); setSent(true); }
    catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Reset your password" sub="We’ll email you a link if the address belongs to an account.">
      {mode === 'local' && <Notice tone="info">Password reset needs real accounts, which need a configured Supabase project.</Notice>}
      {sent ? <Notice tone="ok" title="Check your inbox">If an account exists for that address, a reset link is on its way.</Notice> : (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <Field label="Email" type="email" autoComplete="email" value={value} error={err} onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" loading={busy} className="w-full">Send reset link</Button>
        </form>
      )}
      <p className="mt-6 text-sm"><Link to="/auth/login" className="font-semibold text-signal-deep underline">Back to sign in</Link></p>
    </Shell>
  );
}

/** Landing page for the password-reset e-mail link: the link signs the learner in with a short-lived recovery session. */
export function ResetPassword() {
  useDocumentTitle('Choose a new password');
  const { auth } = useServices(); const { user, loading } = useAuth(); const navigate = useNavigate();
  const [form, setForm] = useState({ password: '', confirm: '' }); const [fe, setFe] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const p = z.object({ password: z.string().min(10, 'Use at least 10 characters.').max(128), confirm: z.string() })
      .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'The two passwords don’t match.' }).safeParse(form);
    if (!p.success) { setFe(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]))); return; }
    setFe({}); setBusy(true);
    try { await auth.updatePassword(p.data.password); setDone(true); } catch (x) { setErr(authMessage(x)); } finally { setBusy(false); }
  };

  if (loading) return <Shell title="Checking your link…" sub=""><p role="status" className="text-muted">One moment.</p></Shell>;
  if (!user) return (
    <Shell title="This link has expired" sub="Reset links work once and only for a short time.">
      <Link to="/auth/forgot-password" className="font-semibold text-signal-deep underline">Request a new reset link</Link>
    </Shell>
  );
  if (done) return (
    <Shell title="Password updated" sub="You’re signed in with your new password.">
      <Button onClick={() => navigate('/dashboard', { replace: true })}>Go to my dashboard</Button>
    </Shell>
  );
  return (
    <Shell title="Choose a new password" sub={`Signed in as ${user.email}.`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {err && <Notice tone="bad" title="Couldn’t update your password">{err}</Notice>}
        <Field label="New password" type="password" autoComplete="new-password" hint="At least 10 characters." value={form.password} error={fe.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} error={fe.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        <Button type="submit" loading={busy} className="w-full">Update password</Button>
      </form>
    </Shell>
  );
}
