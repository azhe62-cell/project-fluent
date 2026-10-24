import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import clsx from 'clsx';

export const cn = clsx;

// ---------------------------------------------------------------- buttons
type Variant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger' | 'gold';
const base =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[0.95rem] font-semibold transition-[background,box-shadow,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px select-none';
const variants: Record<Variant, string> = {
  primary: 'bg-signal text-white shadow-lift hover:bg-signal-deep',
  secondary: 'border border-ink/15 bg-white text-ink hover:border-ink/30 hover:bg-paper',
  ghost: 'text-ink hover:bg-ink/5',
  dark: 'bg-ink text-paper hover:bg-ink-3',
  danger: 'bg-bad text-white hover:bg-bad/90',
  gold: 'bg-gold text-ink hover:bg-gold/85',
};
export const buttonClass = (v: Variant = 'primary', extra?: string) => cn(base, variants[v], extra);

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; loading?: boolean }
export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ variant = 'primary', loading, className, children, disabled, ...rest }, ref) => (
  <button ref={ref} className={buttonClass(variant, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
    {loading && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
    {children}
  </button>
));
Button.displayName = 'Button';

export function LinkButton({ variant = 'primary', className, ...rest }: LinkProps & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...rest} />;
}

// ---------------------------------------------------------------- surfaces
export function Card({ className, children, as: Tag = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'section' | 'article' }) {
  return <Tag className={cn('rounded-sheet border border-paper-edge bg-white shadow-sheet', className)}>{children}</Tag>;
}

type Tone = 'neutral' | 'signal' | 'ok' | 'warn' | 'bad' | 'gold' | 'dark';
const tones: Record<Tone, string> = {
  neutral: 'bg-paper text-ink-3 ring-paper-edge',
  signal: 'bg-signal-soft text-signal-deep ring-signal/20',
  ok: 'bg-ok/10 text-ok ring-ok/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  bad: 'bg-bad/10 text-bad ring-bad/25',
  gold: 'bg-gold-soft text-ink ring-gold',
  dark: 'bg-ink-2 text-mist-2 ring-white/10',
};
export function Badge({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-chip px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone])}>
      {icon}{children}
    </span>
  );
}

export function Notice({ tone = 'info', title, children, className }: { tone?: 'info' | 'ok' | 'warn' | 'bad'; title?: string; children?: ReactNode; className?: string }) {
  const map = {
    info: { cls: 'border-signal/30 bg-signal-soft/60', Icon: Info, ic: 'text-signal-deep' },
    ok: { cls: 'border-ok/30 bg-ok/5', Icon: CheckCircle2, ic: 'text-ok' },
    warn: { cls: 'border-warn/35 bg-gold-soft/60', Icon: AlertTriangle, ic: 'text-warn' },
    bad: { cls: 'border-bad/30 bg-bad/5', Icon: XCircle, ic: 'text-bad' },
  }[tone];
  return (
    <div role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border p-4 text-sm', map.cls, className)}>
      <map.Icon className={cn('mt-0.5 h-5 w-5 shrink-0', map.ic)} aria-hidden />
      <div>{title && <p className="font-semibold">{title}</p>}{children && <div className={cn('text-ink-3', title && 'mt-1')}>{children}</div>}</div>
    </div>
  );
}

// ---------------------------------------------------------------- forms
interface FieldProps extends InputHTMLAttributes<HTMLInputElement> { label: string; hint?: string; error?: string | null }
export const Field = forwardRef<HTMLInputElement, FieldProps>(({ label, hint, error, className, id, ...rest }, ref) => {
  const auto = useId(); const fid = id ?? auto;
  return (
    <div className={className}>
      <label htmlFor={fid} className="mb-1.5 block text-sm font-semibold text-ink">{label}</label>
      <input
        ref={ref} id={fid}
        aria-invalid={!!error || undefined}
        aria-describedby={cn(hint && `${fid}-hint`, error && `${fid}-err`) || undefined}
        className={cn('w-full rounded-xl border bg-white px-3.5 py-2.5 text-[0.98rem] text-ink placeholder:text-muted/70', error ? 'border-bad' : 'border-ink/20 hover:border-ink/35')}
        {...rest}
      />
      {hint && !error && <p id={`${fid}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>}
      {error && <p id={`${fid}-err`} className="mt-1.5 text-xs font-medium text-bad">{error}</p>}
    </div>
  );
});
Field.displayName = 'Field';

// ---------------------------------------------------------------- misc
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-muted">
      <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-sheet border border-dashed border-ink/20 bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-signal-soft text-signal-deep">{icon}</div>}
      <h3 className="text-xl font-semibold">{title}</h3>
      {children && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto max-w-md py-12">
      <Notice tone="bad" title="That didn’t load">{message}</Notice>
      {onRetry && <div className="mt-4 text-center"><Button variant="secondary" onClick={onRetry}>Try again</Button></div>}
    </div>
  );
}

export function Meter({ value, max, label, tone = 'signal' }: { value: number; max: number; label: string; tone?: 'signal' | 'ok' | 'warn' }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  const fill = { signal: 'bg-signal', ok: 'bg-ok', warn: 'bg-warn' }[tone];
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} of ${max}`} className="h-2.5 w-full overflow-hidden rounded-full bg-ink/10">
      <div className={cn('h-full rounded-full transition-[width] duration-500', fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, action }: { eyebrow?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-signal-deep">{eyebrow}</p>}
        <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
        {children && <p className="mt-2 max-w-2xl text-muted">{children}</p>}
      </div>
      {action}
    </header>
  );
}

/**
 * Native <dialog>: gives us a focus trap, Esc-to-close and inert background for free.
 * `close` events can arrive late (observed in Chromium); a stale one must never close a dialog that has since been reopened,
 * so it is ignored while the element is open. `cancel` (Esc) updates our state immediately.
 */
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const tid = useId();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={tid} onClose={() => { if (ref.current?.open) return; onClose(); }} onCancel={() => onClose()} className={cn('max-h-[88dvh] overflow-y-auto rounded-2xl border border-paper-edge bg-white p-0 text-ink shadow-2xl', size === 'lg' ? 'w-[min(94vw,40rem)]' : 'w-[min(92vw,30rem)]')}>
      <div className="p-6">
        <h2 id={tid} className="text-2xl font-semibold">{title}</h2>
        <div className="mt-3 text-[0.95rem] text-ink-3">{children}</div>
      </div>
      {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-paper-edge bg-paper-2 px-6 py-4">{footer}</div>}
    </dialog>
  );
}

export function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <p className={cn('font-mono text-xs font-semibold uppercase tracking-[0.16em]', dark ? 'text-gold' : 'text-signal-deep')}>{children}</p>;
}
