import { useAuth } from '@/lib/auth-context';
import { AppLayout } from './AppLayout';
import { MarketingLayout } from './MarketingLayout';

/** Public pages that signed-in learners should see inside the app shell. */
export function AdaptiveLayout() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center text-muted" role="status">Loading…</div>;
  return user ? <AppLayout /> : <MarketingLayout />;
}
