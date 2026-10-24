/** Original mark: an open ring (the learning loop) with a gold marker. Replaceable asset. */
export function LogoMark({ size = 30, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="rgb(var(--ink-2))" />
      <path d="M22.5 11.2A8 8 0 1 0 24 16" fill="none" stroke="rgb(var(--signal-light))" strokeWidth="3" strokeLinecap="round" />
      <circle cx="23.2" cy="9.4" r="2.4" fill="rgb(var(--gold))" />
    </svg>
  );
}

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className={`font-display text-[1.35rem] font-semibold leading-none tracking-tight ${dark ? 'text-ink' : 'text-paper'}`}>
        Fluent<span className="text-gold">.</span>
      </span>
    </span>
  );
}
