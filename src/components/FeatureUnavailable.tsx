import { Hammer } from 'lucide-react';
import { EmptyState, LinkButton } from './ui/ui';

/** Shown when the active backend doesn't implement a feature yet — never a silent empty list. */
export function FeatureUnavailable({ name }: { name: string }) {
  return (
    <EmptyState icon={<Hammer />} title={`${name} isn’t available with this backend yet`} action={<LinkButton to="/dashboard" variant="secondary">Back to dashboard</LinkButton>}>
      The Supabase integration currently covers accounts, exams, scoring and reports. {name} works in local demo mode and is planned for the Supabase backend next.
    </EmptyState>
  );
}
