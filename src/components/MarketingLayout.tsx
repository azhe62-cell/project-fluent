import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Wordmark } from './ui/Logo';
import { buttonClass, cn } from './ui/ui';
import { useAuth } from '@/lib/auth-context';
import { ModeBanner } from './ModeBanner';

const links = [
  { to: '/practice', label: 'Practice' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/about', label: 'About' },
];

export function MarketingLayout({ dark = false }: { dark?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const shell = dark ? 'on-dark bg-ink text-paper' : 'bg-paper-2 text-ink';
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cn('rounded-lg px-3 py-2 text-sm font-medium transition-colors', dark ? 'text-mist-2 hover:text-white' : 'text-ink-3 hover:text-ink', isActive && (dark ? 'text-white' : 'text-ink underline decoration-signal decoration-2 underline-offset-8'));
  return (
    <div className={cn('flex min-h-screen flex-col', shell)}>
      <a href="#main" className="skip-link">Skip to content</a>
      <ModeBanner />
      <header className={cn('sticky top-0 z-40 border-b backdrop-blur', dark ? 'border-white/10 bg-ink/85' : 'border-paper-edge bg-paper-2/90')}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/" aria-label="Fluent home"><Wordmark dark={!dark} /></Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {links.map((l) => <NavLink key={l.to} to={l.to} className={linkCls}>{l.label}</NavLink>)}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {user ? (
              <Link to="/dashboard" className={buttonClass(dark ? 'gold' : 'primary')}>Dashboard</Link>
            ) : (<>
              <Link to="/auth/login" className={buttonClass('ghost', dark ? 'text-paper hover:bg-white/10' : '')}>Sign in</Link>
              <Link to="/auth/register" className={buttonClass(dark ? 'gold' : 'primary')}>Create account</Link>
            </>)}
          </div>
          <button className="rounded-lg p-2 md:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
            {open ? <X /> : <Menu />}
          </button>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label="Mobile" className={cn('flex flex-col gap-1 border-t px-5 py-4 md:hidden', dark ? 'border-white/10' : 'border-paper-edge')}>
            {links.map((l) => <NavLink key={l.to} to={l.to} className={linkCls} onClick={() => setOpen(false)}>{l.label}</NavLink>)}
            <Link to={user ? '/dashboard' : '/auth/login'} className={linkCls({ isActive: false })} onClick={() => setOpen(false)}>{user ? 'Dashboard' : 'Sign in'}</Link>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1"><Outlet /></main>
      <footer className={cn('border-t', dark ? 'border-white/10 bg-ink-2' : 'border-paper-edge bg-paper')}>
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Wordmark dark={!dark} />
            <p className={cn('mt-4 max-w-sm text-sm', dark ? 'text-mist-2' : 'text-muted')}>
              An independent, free practice platform. <strong>Not affiliated with, endorsed by, or connected to IELTS or any exam provider.</strong> Scores shown are practice estimates, not official results.
            </p>
          </div>
          <FooterCol dark={dark} title="Platform" items={[['/practice', 'Practice catalogue'], ['/how-it-works', 'How it works'], ['/sample', 'Try a sample']]} />
          <FooterCol dark={dark} title="Legal" items={[['/about', 'About'], ['/privacy', 'Privacy'], ['/terms', 'Terms & disclaimer']]} />
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, items, dark }: { title: string; items: [string, string][]; dark: boolean }) {
  return (
    <nav aria-label={title}>
      <p className={cn('font-mono text-xs font-semibold uppercase tracking-[0.14em]', dark ? 'text-gold' : 'text-signal-deep')}>{title}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map(([to, label]) => <li key={to}><Link to={to} className={dark ? 'text-mist-2 hover:text-white' : 'text-ink-3 hover:text-ink'}>{label}</Link></li>)}
      </ul>
    </nav>
  );
}
