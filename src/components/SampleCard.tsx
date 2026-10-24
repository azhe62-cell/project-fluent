import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { sampleItems, samplePassage } from '@/content/sample';
import { Button, cn } from './ui/ui';

const CHOICES = [
  { id: 'TRUE', label: 'True' }, { id: 'FALSE', label: 'False' }, { id: 'NOT_GIVEN', label: 'Not Given' },
] as const;

/** Public sample exercise. Checked in the browser; only these two public items are involved. */
export function SampleCard({ tilt = false }: { tilt?: boolean }) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const allAnswered = sampleItems.every((i) => picked[i.id]);
  const score = sampleItems.filter((i) => picked[i.id] === i.answer).length;

  return (
    <div className={cn('relative rounded-sheet bg-paper text-ink shadow-2xl ring-1 ring-black/10 transition-transform duration-300', tilt && 'lg:-rotate-1 lg:hover:rotate-0')}>
      <div className="flex items-center justify-between border-b border-paper-edge px-5 py-3">
        <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-signal-deep">Sample · Reading</p>
        <p className="text-xs text-muted">2 questions · no sign-up</p>
      </div>
      <div className="ruled px-5 pb-1 pt-4">
        <h3 className="font-display text-lg font-semibold">{samplePassage.title}</h3>
        <div className="reading-text mt-2 space-y-2 text-[0.98rem] leading-8">
          {samplePassage.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      </div>
      <form className="space-y-4 px-5 py-5" onSubmit={(e) => { e.preventDefault(); setChecked(true); }}>
        <p className="text-xs font-semibold text-ink-3">Do the statements agree with the passage?</p>
        {sampleItems.map((item, idx) => {
          const right = picked[item.id] === item.answer;
          return (
            <fieldset key={item.id} className="margin-rule">
              <legend className="sr-only">Question {idx + 1}</legend>
              <span className="absolute left-0 top-0 w-9 text-right font-mono text-sm font-semibold text-signal-deep" aria-hidden>{idx + 1}</span>
              <p className="text-[0.95rem] font-medium">{item.statement}</p>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={item.statement}>
                {CHOICES.map((c) => (
                  <label key={c.id} className={cn('cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal',
                    picked[item.id] === c.id ? 'border-signal bg-signal text-white' : 'border-ink/20 bg-white hover:border-ink/40', checked && 'pointer-events-none')}>
                    <input type="radio" className="sr-only" name={item.id} value={c.id} checked={picked[item.id] === c.id} disabled={checked}
                      onChange={() => setPicked((p) => ({ ...p, [item.id]: c.id }))} />
                    {c.label}
                  </label>
                ))}
              </div>
              {checked && (
                <p className={cn('mt-2 flex gap-2 text-sm', right ? 'text-ok' : 'text-bad')} role="status">
                  {right ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                  <span><strong>{right ? 'Correct' : 'Not quite'} — {CHOICES.find((c) => c.id === item.answer)!.label}.</strong> <span className="text-ink-3">{item.why}</span></span>
                </p>
              )}
            </fieldset>
          );
        })}
        {!checked ? (
          <Button type="submit" disabled={!allAnswered} className="w-full">{allAnswered ? 'Check my answers' : 'Answer both to check'}</Button>
        ) : (
          <div className="flex items-center justify-between gap-3" role="status">
            <p className="text-sm font-semibold">You got {score} of {sampleItems.length}.</p>
            <Button variant="secondary" type="button" onClick={() => { setPicked({}); setChecked(false); }}>Try again</Button>
          </div>
        )}
      </form>
    </div>
  );
}
