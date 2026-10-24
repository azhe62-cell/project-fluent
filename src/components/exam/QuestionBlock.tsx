import { useId, type ReactNode } from 'react';
import { CheckCircle2, Flag, HelpCircle, PencilLine } from 'lucide-react';
import { countWords, normaliseText, type AnswerValue, type PublicQuestion, type ResponseDraft } from '@/engine';
import { cn } from '@/components/ui/ui';

interface Props {
  question: PublicQuestion;
  draft: ResponseDraft | undefined;
  onAnswer: (a: AnswerValue) => void;
  onFlag: () => void;
  onUnsure: () => void;
  sharedOptions?: { id: string; label: string }[];
  disabled?: boolean;
  /** Hide the exam-only flag / unsure controls (used in practice sessions). */
  hideControls?: boolean;
}

const BLANK = /_{3,}/;
const WORDS = ['zero', 'one', 'TWO', 'THREE', 'FOUR', 'FIVE'];
export const isAnswered = (a: AnswerValue | undefined) => (Array.isArray(a) ? a.length > 0 : typeof a === 'string' && a.trim() !== '');

/** Shared look for every native radio/checkbox "tile": the real input is visually hidden but still the focus target. */
const tile = 'has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal';

/**
 * One question, rendered by type with an unmistakable answer control.
 * All controls are native inputs (keyboard + screen-reader support for free) and are fully controlled by `draft`,
 * so answers survive navigating between questions, passages and panes.
 */
export function QuestionBlock({ question: q, draft, onAnswer, onFlag, onUnsure, sharedOptions, disabled, hideControls }: Props) {
  const uid = useId();
  const answer = draft?.answer ?? null;
  const answered = isAnswered(answer);
  const options = q.options ?? sharedOptions ?? [];
  const isCompletion = q.type === 'sentence_completion' || q.type === 'summary_completion';
  const inlineBlank = isCompletion && BLANK.test(q.prompt);
  const hintId = `${uid}-hint`;
  const radioName = `${uid}-r`;

  // ---- text answer field (inline at the blank, or beside/below the question) -------------------------------------
  const textValue = typeof answer === 'string' ? answer : '';
  const words = countWords(normaliseText(textValue, true));
  const over = !!q.wordLimit && words > q.wordLimit;
  const field = (
    <input
      id={`${uid}-in`} type="text" value={textValue} disabled={disabled} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={200}
      placeholder="Type answer" aria-label={`Answer for question ${q.number}`}
      aria-describedby={cn(q.wordLimit && hintId, over && `${uid}-over`) || undefined} aria-invalid={over || undefined}
      onChange={(e) => onAnswer(e.target.value === '' ? null : e.target.value)}
      // inline fields start compact and grow with what is typed, so the sentence reads naturally and long answers stay visible
      style={inlineBlank ? { width: `calc(${Math.min(22, Math.max(10, textValue.length + 2))}ch + 1.75rem)` } : undefined}
      className={cn(
        'h-10 rounded-lg border-2 px-3 font-mono text-[1rem] text-ink placeholder:font-sans placeholder:text-[0.85rem] placeholder:text-muted/80 disabled:opacity-60',
        inlineBlank ? '-my-1 mx-1 max-w-full align-middle' : 'mt-3 block w-full max-w-md',
        over ? 'border-bad bg-bad/5' : textValue ? 'border-signal bg-white' : 'border-dashed border-ink/50 bg-paper-2 hover:border-ink/70',
      )}
    />
  );

  const limitChip = q.wordLimit ? (
    <p id={hintId} className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-paper px-2.5 py-1 text-xs font-semibold text-ink-3">
      <PencilLine className="h-3.5 w-3.5 text-signal-deep" aria-hidden />
      <span>{q.instructions ?? `NO MORE THAN ${q.wordLimit} WORD${q.wordLimit > 1 ? 'S' : ''}`}</span>
      <span className={cn('font-mono tabular', over ? 'text-bad' : 'text-muted')}>{words}/{q.wordLimit}</span>
    </p>
  ) : null;

  const prompt: ReactNode = inlineBlank ? (() => {
    const [before, after] = q.prompt.split(BLANK);
    return <p className="text-[1rem] leading-8">{before}{field}{after}</p>;
  })() : <p className="text-[1rem] font-medium leading-relaxed">{q.prompt}</p>;

  return (
    <article
      id={`q-${q.id}`} data-question={q.id} data-answered={answered || undefined} aria-label={`Question ${q.number}`}
      className={cn('scroll-mt-3 rounded-xl border p-4 transition-colors sm:p-5', answered ? 'border-signal/50 bg-signal-soft/30' : 'border-paper-edge bg-white')}
    >
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 grid h-8 min-w-8 shrink-0 place-items-center rounded-lg px-1 font-mono text-sm font-semibold', answered ? 'bg-ink text-paper' : 'border-2 border-ink/35 bg-white text-ink')} aria-hidden>{q.number}</span>
        <div className="min-w-0 flex-1">
          <span className="sr-only">Question {q.number}. </span>
          {prompt}
          {isCompletion && limitChip}
          {q.type === 'short_answer' && (<>{field}{limitChip}</>)}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-1" aria-hidden={false}>
          {answered && <span className="text-signal-deep" title="Answered"><CheckCircle2 className="h-5 w-5" aria-hidden /><span className="sr-only">Answered</span></span>}
          {draft?.flagged && <span className="text-warn" title="Flagged for review"><Flag className="h-5 w-5 fill-gold" aria-hidden /><span className="sr-only">Flagged for review</span></span>}
        </div>
      </div>

      {/* ---- True / False / Not Given: three equal, distinct choices */}
      {q.type === 'true_false_not_given' && (
        <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label={`Question ${q.number} answer`}>
          {options.map((o) => (
            <label key={o.id} className={cn(tile, 'flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-2 px-2 py-2 text-center text-[0.92rem] font-semibold leading-tight transition-colors',
              answer === o.id ? 'border-ink bg-ink text-paper' : 'border-ink/25 bg-white hover:border-ink/60', disabled && 'cursor-not-allowed opacity-60')}>
              <input type="radio" className="sr-only" name={radioName} value={o.id} checked={answer === o.id} disabled={disabled} onChange={() => onAnswer(o.id)} />
              {answer === o.id && <CheckCircle2 className="h-4 w-4 shrink-0 text-gold" aria-hidden />}{o.label}
            </label>
          ))}
        </div>
      )}

      {/* ---- Matching information: paragraph letters */}
      {q.type === 'matching_information' && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-muted">Choose the paragraph</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Question ${q.number} answer`}>
            {options.map((o) => (
              <label key={o.id} className={cn(tile, 'grid h-11 min-w-11 cursor-pointer place-items-center rounded-lg border-2 px-3 font-mono text-base font-semibold transition-colors',
                answer === o.id ? 'border-ink bg-ink text-paper' : 'border-ink/25 bg-white hover:border-ink/60')}>
                <input type="radio" className="sr-only" name={radioName} value={o.id} checked={answer === o.id} disabled={disabled} onChange={() => onAnswer(o.id)} />
                {o.id}<span className="sr-only"> — {o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ---- Multiple choice */}
      {q.type === 'multiple_choice' && (
        <div className="mt-4 space-y-2" role="radiogroup" aria-label={`Question ${q.number} answer`}>
          {options.map((o) => (
            <label key={o.id} className={cn(tile, 'flex cursor-pointer items-start gap-3 rounded-lg border-2 px-3.5 py-3 text-[0.97rem] leading-snug transition-colors',
              answer === o.id ? 'border-ink bg-white shadow-[inset_4px_0_0_rgb(var(--signal))]' : 'border-ink/20 bg-white hover:border-ink/50')}>
              <input type="radio" className="sr-only" name={radioName} value={o.id} checked={answer === o.id} disabled={disabled} onChange={() => onAnswer(o.id)} />
              <span className={cn('mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 font-mono text-xs font-semibold', answer === o.id ? 'border-ink bg-ink text-paper' : 'border-ink/35')} aria-hidden>{o.id}</span>
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}

      {/* ---- Choose N: checkboxes with the required count stated */}
      {q.type === 'multi_select' && (() => {
        const chosen = Array.isArray(answer) ? answer : [];
        const need = q.selectCount ?? 1; const full = chosen.length >= need;
        return (
          <fieldset className="mt-4">
            <legend className="mb-2 flex w-full flex-wrap items-center gap-2 text-sm font-semibold">
              <span className="rounded-md bg-ink px-2 py-0.5 text-xs uppercase tracking-wide text-paper">Choose {WORDS[need] ?? need} answers</span>
              <span role="status" className="font-mono text-xs tabular text-muted">{chosen.length} of {need} selected</span>
            </legend>
            <div className="space-y-2">
              {options.map((o) => {
                const on = chosen.includes(o.id);
                return (
                  <label key={o.id} className={cn(tile, 'flex cursor-pointer items-start gap-3 rounded-lg border-2 px-3.5 py-3 text-[0.97rem] leading-snug transition-colors',
                    on ? 'border-ink bg-white shadow-[inset_4px_0_0_rgb(var(--signal))]' : 'border-ink/20 bg-white hover:border-ink/50', !on && full && 'cursor-not-allowed opacity-55')}>
                    <input type="checkbox" className="sr-only" checked={on} disabled={disabled || (!on && full)}
                      onChange={() => { const next = on ? chosen.filter((c) => c !== o.id) : [...chosen, o.id]; onAnswer(next.length ? next : null); }} />
                    <span className={cn('mt-px grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 font-mono text-xs font-semibold', on ? 'border-ink bg-ink text-paper' : 'border-ink/35')} aria-hidden>{o.id}</span>
                    <span>{o.label}</span>
                  </label>
                );
              })}
            </div>
            {full && <p className="mt-2 text-xs text-muted">You’ve chosen {need}. Untick one to change your choice.</p>}
          </fieldset>
        );
      })()}

      {over && <p id={`${uid}-over`} role="alert" className="mt-2 text-xs font-semibold text-bad">That’s {words} words; the limit is {q.wordLimit}. Answers over the limit score zero.</p>}

      {!hideControls && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-paper-edge pt-3">
          <button type="button" onClick={onFlag} aria-pressed={!!draft?.flagged} disabled={disabled}
            className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors', draft?.flagged ? 'bg-gold text-ink ring-gold' : 'text-ink-3 ring-ink/20 hover:text-ink hover:ring-ink/40')}>
            <Flag className="h-3.5 w-3.5" aria-hidden />{draft?.flagged ? 'Flagged for review' : 'Flag for review'}
          </button>
          <button type="button" onClick={onUnsure} aria-pressed={!!draft?.unsure} disabled={disabled}
            className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors', draft?.unsure ? 'bg-signal-soft text-signal-deep ring-signal/40' : 'text-ink-3 ring-ink/20 hover:text-ink hover:ring-ink/40')}>
            <HelpCircle className="h-3.5 w-3.5" aria-hidden />{draft?.unsure ? 'Marked as unsure' : 'I’m not sure'}
          </button>
        </div>
      )}
    </article>
  );
}
