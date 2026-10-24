import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useServices } from './services-context';
import type { AuthUser } from '@/services/types';

interface AuthState { user: AuthUser | null; loading: boolean }
const Ctx = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useServices();
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  useEffect(() => {
    let alive = true;
    auth.getUser().then((user) => alive && setState({ user, loading: false })).catch(() => alive && setState({ user: null, loading: false }));
    const off = auth.subscribe((user) => alive && setState({ user, loading: false }));
    return () => { alive = false; off(); };
  }, [auth]);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

/** Sends signed-out visitors to sign-in and remembers where they were going. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="grid min-h-[50vh] place-items-center text-muted" role="status">Checking your session…</div>;
  if (!user) return <Navigate to={`/auth/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** Only allow same-site relative paths as a post-login destination (prevents open redirects). */
export const safeNext = (raw: string | null) => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard');
