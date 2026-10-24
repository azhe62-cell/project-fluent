import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getServices } from '@/services';
import type { Services } from '@/services/types';

const Ctx = createContext<Services | null>(null);

export function ServicesProvider({ children, services: injected }: { children: ReactNode; services?: Services }) {
  const [loaded, setServices] = useState<Services | null>(null);
  const services = injected ?? loaded;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (injected) return;
    getServices().then(setServices).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [injected]);

  if (error)
    return (
      <div className="mx-auto max-w-lg p-8" role="alert">
        <h1 className="text-2xl font-semibold">Couldn’t start the app</h1>
        <p className="mt-3 text-muted">{error}</p>
        <p className="mt-3 text-sm text-muted">Check your <code>.env</code> against <code>.env.example</code>, or clear both Supabase variables to run in local demo mode.</p>
      </div>
    );
  if (!services) return <div className="grid min-h-screen place-items-center text-muted" role="status">Loading…</div>;
  return <Ctx.Provider value={services}>{children}</Ctx.Provider>;
}

export function useServices(): Services {
  const s = useContext(Ctx);
  if (!s) throw new Error('useServices must be used inside <ServicesProvider>');
  return s;
}
