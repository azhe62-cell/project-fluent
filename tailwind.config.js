/** Design tokens live in src/styles/index.css as CSS variables; Tailwind maps them here. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v('ink'), 2: v('ink-2'), 3: v('ink-3') },
        paper: { DEFAULT: v('paper'), 2: v('paper-2'), edge: v('paper-edge') },
        signal: { DEFAULT: v('signal'), soft: v('signal-soft'), deep: v('signal-deep'), light: v('signal-light') },
        gold: { DEFAULT: v('gold'), soft: v('gold-soft') },
        muted: v('muted'),
        ok: v('ok'), warn: v('warn'), bad: v('bad'),
        mist: { DEFAULT: v('mist'), 2: v('mist-2') },
      },
      fontFamily: {
        display: ['"Fraunces Variable"', 'Georgia', 'serif'],
        sans: ['"Hanken Grotesk Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { sheet: '14px', chip: '999px' },
      boxShadow: {
        sheet: '0 1px 0 rgb(var(--ink) / .04), 0 12px 32px -18px rgb(var(--ink) / .35)',
        lift: '0 18px 50px -24px rgb(var(--signal) / .55)',
      },
      screens: { xs: '420px' },
      keyframes: {
        rise: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: { rise: 'rise .5s cubic-bezier(.2,.7,.2,1) both' },
    },
  },
  plugins: [],
};
