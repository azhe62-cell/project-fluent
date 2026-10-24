import { ShieldAlert } from 'lucide-react';
import { EmptyState, Notice } from '@/components/ui/ui';
import { useServices } from '@/lib/services-context';
import { useDocumentTitle } from '@/lib/hooks';

/**
 * Administration is NOT built in this milestone. This page exists so the routes resolve and
 * say so honestly. Real admin access must be enforced on the server (RLS + role claims), never
 * by hiding links — see supabase/migrations for the `is_admin()` policy helper.
 */
export default function AdminNotAvailable() {
  useDocumentTitle('Administration');
  const { mode } = useServices();
  return (
    <div className="mx-auto max-w-2xl p-8">
      <EmptyState icon={<ShieldAlert />} title="Administration isn’t available yet">
        Content administration (tests, questions, media) is planned for a later milestone and must be enforced by the server, not the browser.
      </EmptyState>
      {mode === 'local' && <Notice tone="warn" className="mt-4" title="Local demo mode">There is no server in this mode, so there is nothing to authorise an administrator against.</Notice>}
    </div>
  );
}
