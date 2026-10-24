import { FlaskConical } from 'lucide-react';
import { useServices } from '@/lib/services-context';

/** Always-visible honesty marker when running without a real backend. */
export function ModeBanner() {
  const { mode } = useServices();
  if (mode !== 'local') return null;
  return (
    <div className="border-b border-gold/60 bg-gold-soft px-4 py-2 text-center text-[0.8rem] text-ink" role="note">
      <FlaskConical className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" aria-hidden />
      <strong>Local demo mode.</strong> Data stays in this browser and there are no real accounts. Answer keys are loaded in the page, so this mode is for trying things out only — not for real learners.
    </div>
  );
}
