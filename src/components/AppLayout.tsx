import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BarChart3, BookMarked, History, LayoutDashboard, LibraryBig, LogOut, Menu, Settings, Sparkles, X } from 'lucide-react';
import { Wordmark } from './ui/Logo';
import { cn } from './ui/ui';
import { useAuth } from '@/lib/auth-context';
import { useServices } from '@/lib/services-context';
import { ModeBanner } from './ModeBanner';

const nav = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/practice', label: 'Catalogue', Icon: LibraryBig },
  { to: '/practice/recommended', label: 'Recommended', Icon: Sparkles },
  { to: '/mistake-vault', label: 'Mistake Vault', Icon: BookMarked },
  { to: '/history', label: 'History', Icon: History },
  { to: '/progress', label: 'Progress', Icon: BarChart3 },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

export function AppLayout() {
  const { user } = useAuth();
  const { auth } = useServices();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const items = (onClick?: () => void) => nav.map(({ to, label, Icon }) => (
    <NavLink key={to} to={to} end={to === '/practice'} onClick={onClick}
      className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors', isActive ? 'bg-white/10 text-white' : 'text-mist-2 hover:bg-white/5 hover:text-white')}>
      <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden />{label}
    </NavLink>
  ));
  const signOut = async () => { await auth.signOut(); navigate('/'); };

  return (
    <div className="min-h-screen bg-paper-2 lg:grid lg:grid-cols-[16.5rem_1fr]">
      <a href="#main" className="skip-link">Skip to content</a>
      {/* Desktop rail */}
      <aside className="on-dark sticky top-0 hidden h-screen flex-col bg-ink px-4 py-6 text-paper lg:flex">
        <Link to="/dashboard" className="px-2" aria-label="Fluent dashboard"><Wordmark /></Link>
        <nav aria-label="App" className="mt-8 flex flex-1 flex-col gap-1">{items()}</nav>
        <div className="rounded-xl bg-ink-2 p-3 text-sm">
          <p className="truncate font-semibold text-white">{user?.displayName}</p>
          <p className="truncate text-xs text-mist">{user?.email}</p>
          <button onClick={signOut} className="mt-3 flex items-center gap-2 text-xs font-semibold text-gold hover:underline"><LogOut className="h-3.5 w-3.5" aria-hidden />Sign out</button>
        </div>
      </aside>
      <div className="min-w-0">
        <ModeBanner />
        {/* Mobile bar */}
        <div className="on-dark sticky top-0 z-30 flex h-14 items-center justify-between bg-ink px-4 text-paper lg:hidden">
          <Link to="/dashboard" aria-label="Fluent dashboard"><Wordmark /></Link>
          <button aria-expanded={open} aria-controls="app-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)} className="rounded-lg p-2">{open ? <X /> : <Menu />}</button>
        </div>
        {open && (
          <nav id="app-menu" aria-label="App menu" className="on-dark grid gap-1 bg-ink px-4 pb-4 lg:hidden">
            {items(() => setOpen(false))}
            <button onClick={signOut} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gold"><LogOut className="h-[1.15rem] w-[1.15rem]" aria-hidden />Sign out</button>
          </nav>
        )}
        <main id="main" className="mx-auto max-w-5xl px-5 py-8 sm:py-10 lg:px-10"><Outlet /></main>
      </div>
    </div>
  );
}
