// @vitest-environment jsdom
import './setup-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '@/App';
import { ServicesProvider } from '@/lib/services-context';
import { AuthProvider } from '@/lib/auth-context';
import { createLocalServices } from '@/services/local';
import { MemoryStore } from '@/services/local/storage';
import { TimerChip } from '@/components/exam/ExamChrome';
import { readingMiniMock01 as mock } from '@/content/reading-mini-mock-01.public';
import type { Services } from '@/services/types';

/** The redesigned exam workspace, exercised through the real screens (local adapter). */
const TEST_ID = 'test-reading-mini-01';
let store: MemoryStore; let services: Services; let attemptId: string; let skewMs = 0;
const setWidth = (w: number) => { (window as any).innerWidth = w; window.dispatchEvent(new Event('resize')); };

async function begin(opts: { startSkewMs?: number } = {}) {
  store = new MemoryStore(); skewMs = opts.startSkewMs ?? 0;
  services = createLocalServices(store, () => new Date(Date.now() + skewMs));
  await services.auth.signUp({ email: 'exam@example.com', displayName: 'Exam Tester' });
  attemptId = (await services.assessments.startOrResumeAttempt(TEST_ID)).attempt.id;
  skewMs = 0;                                                    // from here on the "server" clock is the real clock
}
const open = () => render(
  <MemoryRouter initialEntries={[`/attempts/${attemptId}`]}><ServicesProvider services={services}><AuthProvider><App /></AuthProvider></ServicesProvider></MemoryRouter>,
);
const card = (n: number) => document.querySelector<HTMLElement>(`[data-question="rd01-q${String(n).padStart(2, '0')}"]`)!;
const palette = (n: number) => screen.getByRole('button', { name: new RegExp(`^Question ${n}:`) });
const toPassage2 = async (u: ReturnType<typeof userEvent.setup>) => { await u.click(screen.getByRole('tab', { name: 'Passage 2' })); await screen.findByRole('heading', { name: 'Letting the Tide Back In', level: 2 }); };

beforeEach(async () => { setWidth(1280); localStorage.clear(); await begin(); });
afterEach(() => { cleanup(); setWidth(1024); });

describe('every question type renders an obvious, working control', () => {
  it('passage 1: MCQ radios, T/F/NG segmented choices, inline completion fields, choose-two checkboxes', async () => {
    open(); await screen.findByRole('timer');
    for (const n of [1, 2]) expect(within(card(n)).getAllByRole('radio'), `Q${n}`).toHaveLength(4);
    for (const n of [3, 4, 5]) {
      const labels = within(card(n)).getAllByRole('radio').map((r) => (r.closest('label') as HTMLElement).textContent!.trim());
      expect(labels, `Q${n}`).toEqual(['True', 'False', 'Not Given']);
    }
    for (const n of [6, 7, 8]) { const f = within(card(n)).getByRole('textbox', { name: `Answer for question ${n}` }) as HTMLInputElement; expect([f.tagName, f.type, f.disabled], `Q${n}`).toEqual(['INPUT', 'text', false]); }
    expect(within(card(9)).getAllByRole('checkbox')).toHaveLength(5);
    expect(within(card(9)).getByText(/choose two answers/i)).toBeTruthy();
  });

  it('passage 2: MCQ, T/F/NG, matching letters A–E, summary gaps, short answer', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer'); await toPassage2(u);
    expect(within(card(10)).getAllByRole('radio')).toHaveLength(4);
    for (const n of [11, 12, 13]) expect(within(card(n)).getAllByRole('radio')).toHaveLength(3);
    for (const n of [14, 15]) expect(within(card(n)).getAllByRole('radio').map((r) => (r as HTMLInputElement).value), `Q${n}`).toEqual(['A', 'B', 'C', 'D', 'E']);
    for (const n of [16, 17, 18, 19]) expect(within(card(n)).getByRole('textbox', { name: `Answer for question ${n}` })).toBeTruthy();
  });

  it('all 19 questions in the data model have a control (none can be rendered blank)', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    const seen = new Set<number>();
    for (const sec of [0, 1]) {
      if (sec === 1) await toPassage2(u);
      for (const q of mock.questions.filter((x) => mock.sections[sec].groups.some((g) => g.questionIds.includes(x.id)))) {
        const c = card(q.number); expect(c, `card for Q${q.number}`).toBeTruthy();
        expect(c.querySelectorAll('input[type="radio"], input[type="checkbox"], input[type="text"]').length, `controls for Q${q.number} (${q.type})`).toBeGreaterThan(0);
        seen.add(q.number);
      }
    }
    expect(seen.size).toBe(19);
  });

  it('sentence completion: the field sits INSIDE the sentence at the blank, labelled, with the limit directly beneath', async () => {
    open(); await screen.findByRole('timer');
    const field = within(card(6)).getByRole('textbox', { name: 'Answer for question 6' }) as HTMLInputElement;
    const sentence = field.closest('p')!;
    expect(sentence.textContent).toContain('The clover-and-grass roofs mainly attracted');       // text before the field…
    expect(sentence.textContent).toContain('species.');                                          // …and after it, in the SAME paragraph
    expect(field.placeholder).toMatch(/type answer/i);                                           // never a mysterious blank
    expect(field.getAttribute('aria-describedby')).toBeTruthy();
    const hint = document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0])!;
    expect(hint.textContent).toMatch(/NO MORE THAN ONE WORD/);
    expect(field.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the limit comes after (below) the field
    expect(sentence.textContent).not.toMatch(/_{3,}/);                                           // raw underscores are never shown
  });

  it('typing updates the live word counter; exceeding the limit warns (and is announced)', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    const f = within(card(6)).getByRole('textbox') as HTMLInputElement;
    expect(within(card(6)).getByText('0/1')).toBeTruthy();
    await u.type(f, 'common'); expect(within(card(6)).getByText('1/1')).toBeTruthy(); expect(within(card(6)).queryByRole('alert')).toBeNull();
    await u.type(f, ' species'); expect(within(card(6)).getByText('2/1')).toBeTruthy();
    expect(within(card(6)).getByRole('alert').textContent).toMatch(/limit is 1/); expect(f.getAttribute('aria-invalid')).toBe('true');
  });

  it('choose-two enforces the count: the rest lock at two and unlock when one is unticked', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    const boxes = within(card(9)).getAllByRole('checkbox') as HTMLInputElement[];
    await u.click(boxes[0]); await u.click(boxes[2]);
    expect(within(card(9)).getByText('2 of 2 selected')).toBeTruthy();
    expect([boxes[1], boxes[3], boxes[4]].every((b) => b.disabled)).toBe(true);
    await u.click(boxes[0]); expect(boxes[1].disabled).toBe(false); expect(within(card(9)).getByText('1 of 2 selected')).toBeTruthy();
  });

  it('True / False / Not Given: exactly one of the three can be selected', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    const [t, f, ng] = within(card(3)).getAllByRole('radio') as HTMLInputElement[];
    await u.click(f); expect([t.checked, f.checked, ng.checked]).toEqual([false, true, false]);
    await u.click(ng); expect([t.checked, f.checked, ng.checked]).toEqual([false, false, true]);
  });
});

describe('answered / unanswered / flagged state and progress', () => {
  it('answering updates the card, the palette (by accessible name, not colour), and the progress read-out', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    expect(screen.getByText('0 of 19 answered')).toBeTruthy(); expect(palette(1).getAttribute('aria-label')).toBe('Question 1: not answered');
    expect(card(1).dataset.answered).toBeUndefined();
    await u.click(within(card(1)).getAllByRole('radio')[1]);
    await u.type(within(card(6)).getByRole('textbox'), 'common');
    expect(palette(1).getAttribute('aria-label')).toBe('Question 1: answered'); expect(palette(6).getAttribute('aria-label')).toBe('Question 6: answered');
    expect(card(1).dataset.answered).toBe('true'); expect(screen.getByText('2 of 19 answered')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: /questions answered/i }).getAttribute('aria-valuenow')).toBe('2');
    await u.clear(within(card(6)).getByRole('textbox'));                                         // clearing makes it unanswered again
    expect(palette(6).getAttribute('aria-label')).toBe('Question 6: not answered'); expect(screen.getByText('1 of 19 answered')).toBeTruthy();
  });

  it('flag for review and "not sure" toggle, show on the palette and card, and survive a reload', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    const flag = within(card(4)).getByRole('button', { name: /flag for review/i });
    expect(flag.getAttribute('aria-pressed')).toBe('false');
    await u.click(flag); expect(flag.getAttribute('aria-pressed')).toBe('true'); expect(palette(4).getAttribute('aria-label')).toMatch(/flagged for review/);
    await u.click(within(card(4)).getByRole('button', { name: /not sure/i })); expect(within(card(4)).getByRole('button', { name: /marked as unsure/i })).toBeTruthy();
    await screen.findByText('Saved', {}, { timeout: 5000 });
    cleanup(); open(); await screen.findByRole('timer');                                         // "refresh"
    expect(palette(4).getAttribute('aria-label')).toMatch(/flagged for review/);
    expect(within(card(4)).getByRole('button', { name: /flagged for review/i }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('navigation preserves answers', () => {
  it('palette jump, passage tabs and Previous / Next (across the passage boundary) never lose typed answers', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    await u.type(within(card(6)).getByRole('textbox'), 'common');
    await u.click(within(card(1)).getAllByRole('radio')[2]);

    await u.click(palette(14));                                                                  // jump into passage 2
    await screen.findByRole('heading', { name: 'Letting the Tide Back In', level: 2 }); expect(card(14)).toBeTruthy();
    await u.type(within(card(16)).getByRole('textbox'), 'half');

    await u.click(screen.getByRole('tab', { name: 'Passage 1' }));                               // and back via the tab
    await screen.findByRole('heading', { name: 'The Rooftop Meadow Experiment', level: 2 });
    expect((within(card(6)).getByRole('textbox') as HTMLInputElement).value).toBe('common');
    expect((within(card(1)).getAllByRole('radio')[2] as HTMLInputElement).checked).toBe(true);
    await u.click(palette(16));                                                                  // passage 2 still remembers
    expect((await screen.findAllByRole('textbox', { name: 'Answer for question 16' }))[0]).toHaveValue('half');
  });

  it('Previous / Next walk question by question and switch passage at the boundary; disabled at the ends', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    const cur = () => document.querySelector('nav[aria-label="Question navigator"] [aria-current="true"]')?.textContent?.replace(/\D/g, '');
    const next = () => screen.getByRole('button', { name: 'Next question' }); const prev = () => screen.getByRole('button', { name: 'Previous question' });
    expect(prev()).toBeDisabled(); expect(cur()).toBe('1');
    await u.click(next()); await waitFor(() => expect(cur()).toBe('2'));
    await u.click(palette(9)); await waitFor(() => expect(cur()).toBe('9'));
    await u.click(next()); await waitFor(() => expect(cur()).toBe('10'));
    await screen.findByRole('heading', { name: 'Letting the Tide Back In', level: 2 });
    await u.click(prev()); await waitFor(() => expect(cur()).toBe('9'));
    await screen.findByRole('heading', { name: 'The Rooftop Meadow Experiment', level: 2 });
    await u.click(palette(19)); await waitFor(() => expect(cur()).toBe('19')); expect(next()).toBeDisabled();
  });
});

describe('submission confirmation', () => {
  it('shows what is unanswered / flagged, does not submit until confirmed, and "Keep working" cancels', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    await u.click(within(card(1)).getAllByRole('radio')[1]);
    await u.click(within(card(5)).getByRole('button', { name: /flag for review/i }));
    await u.click(within(card(7)).getByRole('button', { name: /not sure/i }));
    await u.click(screen.getByRole('button', { name: /^submit$/i }));
    const dlg = await screen.findByRole('dialog', { name: /submit your final answers/i });
    expect(within(dlg).getByText((_, el) => el?.tagName === 'P' && /^1 of 19 questions answered\./.test(el.textContent ?? ''))).toBeTruthy();
    const un = within(dlg).getByRole('list', { name: /18 unanswered/ }); expect(within(un).getAllByRole('button')).toHaveLength(18);
    expect(within(un).queryByRole('button', { name: 'Go to question 1' })).toBeNull();            // answered → not listed
    expect(within(dlg).getByRole('list', { name: /1 flagged for review/ }).textContent).toBe('5');
    expect(within(dlg).getByRole('list', { name: /1 marked unsure/ }).textContent).toBe('7');
    expect(await services.assessments.listResults()).toHaveLength(0);                            // nothing submitted yet
    await u.click(within(dlg).getByRole('button', { name: /keep working/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await services.assessments.listResults()).toHaveLength(0); expect(screen.getByRole('timer')).toBeTruthy();   // still in the exam
  });

  it('"Review unanswered" and the number chips close the dialog and take you to that question', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    await u.click(within(card(1)).getAllByRole('radio')[1]);
    await u.click(screen.getByRole('button', { name: /^submit$/i }));
    await u.click(await screen.findByRole('button', { name: /review unanswered/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement?.closest('[data-question]')?.getAttribute('data-question')).toBe('rd01-q02'));
    await u.click(screen.getByRole('button', { name: /^submit$/i }));
    await u.click(await screen.findByRole('button', { name: 'Go to question 13' }));
    await screen.findByRole('heading', { name: 'Letting the Tide Back In', level: 2 });
    await waitFor(() => expect(document.activeElement?.closest('[data-question]')?.getAttribute('data-question')).toBe('rd01-q13'));
  });

  it('a stale "close" event cannot shut a dialog that was reopened', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    await u.click(screen.getByRole('button', { name: /^submit$/i })); const dlg = await screen.findByRole('dialog');
    fireEvent(dlg, new Event('close'));                                                          // late event while it is still open
    expect(screen.getByRole('dialog', { name: /submit your final answers/i })).toBeTruthy();
  });

  it('confirming submits exactly once and shows the report', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    await u.click(within(card(1)).getAllByRole('radio')[1]); await screen.findByText('Saved', {}, { timeout: 5000 });
    await u.click(screen.getByRole('button', { name: /^submit$/i }));
    const go = within(await screen.findByRole('dialog')).getByRole('button', { name: /submit final answers/i });
    await u.dblClick(go);                                                                        // double-click must not double-submit
    expect(await screen.findByText('Practice marks', {}, { timeout: 8000 })).toBeTruthy();
    expect(await services.assessments.listResults()).toHaveLength(1);
  }, 20_000);
});

describe('timer', () => {
  it('there is exactly one timer, it is a role=timer without a live region, and it counts down', async () => {
    open(); const t = await screen.findByRole('timer'); expect(screen.getAllByRole('timer')).toHaveLength(1);
    expect(t.getAttribute('aria-live')).toBeNull(); expect(t.textContent).toMatch(/^\d{2}:\d{2}/);
    const first = t.textContent; await waitFor(() => expect(screen.getByRole('timer').textContent).not.toBe(first), { timeout: 3500 });
  });
  it('keeps counting while the learner navigates and answers', async () => {
    const u = userEvent.setup(); open(); const t0 = (await screen.findByRole('timer')).textContent!;
    await u.click(palette(14)); await u.click(palette(3)); await u.click(within(card(1)).getAllByRole('radio')[0]);
    await waitFor(() => expect(screen.getByRole('timer').textContent).not.toBe(t0), { timeout: 3500 });
    expect(screen.getAllByRole('timer')).toHaveLength(1);
  });
  it('warns at 5 minutes and 1 minute using colour AND an icon/word, with no animation', () => {
    for (const [secs, level] of [[900, 'normal'], [299, 'warn'], [59, 'urgent'], [0, 'expired']] as const) {
      const { container, unmount } = render(<TimerChip remaining={secs} />);
      const chip = container.querySelector('[role="timer"]')!; expect(chip.getAttribute('data-level')).toBe(level);
      expect(chip.className).not.toMatch(/animate-|pulse|blink|bounce/);
      if (level === 'warn') expect(chip.textContent).toMatch(/under 5 min/); if (level === 'urgent') expect(chip.textContent).toMatch(/under 1 min/);
      if (level !== 'normal') expect(chip.querySelector('svg')).toBeTruthy();
      unmount();
    }
  });
  it('a visible, dismissible banner appears under 5 minutes', async () => {
    cleanup(); await begin({ startSkewMs: -(1200 - 200) * 1000 });                              // attempt that started 1000 s ago → 200 s left
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    const banner = await screen.findByText(/less than 5 minutes left/i); expect(banner.textContent).toMatch(/18 questions? still unanswered|19 questions? still unanswered/);
    await u.click(screen.getByRole('button', { name: /dismiss time warning/i })); expect(screen.queryByText(/less than 5 minutes left/i)).toBeNull();
  });
  it('at zero the existing deadline rules submit the attempt as time-expired (no second timer)', async () => {
    cleanup(); await begin({ startSkewMs: -(1200 - 3) * 1000 });                                 // 3 s left
    open(); await screen.findByRole('timer');
    expect(await screen.findByText(/time ran out/i, {}, { timeout: 12_000 })).toBeTruthy();
    const [r] = await services.assessments.listResults(); expect(r.submissionKind).toBe('time_expired');
  }, 20_000);
});

describe('resizable workspace (desktop)', () => {
  const sep = () => screen.getByRole('separator');
  const pct = () => Number(sep().getAttribute('aria-valuenow'));
  it('has a keyboard-operable divider with limits, Enter / button / double-click reset, and a remembered layout', async () => {
    const u = userEvent.setup(); open(); await screen.findByRole('timer');
    expect(pct()).toBe(50); expect(sep().getAttribute('aria-orientation')).toBe('vertical'); expect(sep().tabIndex).toBe(0);
    sep().focus(); await u.keyboard('{ArrowRight}'); expect(pct()).toBe(52); await u.keyboard('{ArrowLeft}{ArrowLeft}'); expect(pct()).toBe(48);
    await u.keyboard('{Home}'); const min = pct(); expect(min).toBeLessThan(40); await u.keyboard('{End}'); const max = pct(); expect(max).toBeGreaterThan(60);
    expect(Number(localStorage.getItem('fluent.exam.split.v1'))).toBeCloseTo(max / 100, 1);
    await u.keyboard('{Enter}'); expect(pct()).toBe(50);
    await u.keyboard('{ArrowRight}{ArrowRight}'); await u.click(screen.getByRole('button', { name: /reset panel layout/i })); expect(pct()).toBe(50);
    await u.keyboard('{ArrowRight}'); fireEvent.doubleClick(sep()); expect(pct()).toBe(50);
  });
  it('dragging moves the divider but never shrinks either panel below the minimum width', async () => {
    open(); await screen.findByRole('timer');
    const ws = screen.getByTestId('split-workspace'); ws.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 700, right: 1200, bottom: 700, x: 0, y: 0, toJSON() {} });
    fireEvent.pointerDown(sep(), { pointerId: 1, clientX: 600 });
    fireEvent.pointerMove(sep(), { pointerId: 1, clientX: 720 }); expect(pct()).toBe(60);
    fireEvent.pointerMove(sep(), { pointerId: 1, clientX: 5 }); expect(pct()).toBe(28);          // 340 / 1200
    fireEvent.pointerMove(sep(), { pointerId: 1, clientX: 1195 }); expect(pct()).toBe(72);       // 1 − 340 / 1200
    fireEvent.pointerUp(sep(), { pointerId: 1 }); fireEvent.pointerMove(sep(), { pointerId: 1, clientX: 600 }); expect(pct()).toBe(72);   // released: no more dragging
  });
  it('the two panes are separate scroll containers (so one never moves the other)', async () => {
    open(); await screen.findByRole('timer');
    const p = document.querySelector<HTMLElement>('[data-pane="passage"]')!; const q = document.querySelector<HTMLElement>('[data-pane="questions"]')!;
    expect(p).not.toBe(q); expect(p.className).toMatch(/overflow-y-auto/); expect(q.className).toMatch(/overflow-y-auto/);
    expect(p.contains(q) || q.contains(p)).toBe(false);
    expect(p.className).toMatch(/\brelative\b/); expect(q.className).toMatch(/\brelative\b/);     // positioned, so sr-only text can't stretch the document
  });
});

describe('phone / tablet layout', () => {
  it('uses Passage / Questions tabs instead of two squeezed columns, and keeps both panes mounted', async () => {
    cleanup(); setWidth(390); const u = userEvent.setup(); open(); await screen.findByRole('timer');
    expect(screen.queryByRole('separator')).toBeNull(); expect(screen.queryByRole('button', { name: /reset panel layout/i })).toBeNull();
    const pass = () => document.querySelector<HTMLElement>('[data-pane="passage"]')!; const qs = () => document.querySelector<HTMLElement>('[data-pane="questions"]')!;
    expect(qs().className).toMatch(/\bblock\b/); expect(pass().className).toMatch(/\bhidden\b/);
    await u.type(within(card(6)).getByRole('textbox'), 'common');
    await u.click(screen.getByRole('tab', { name: /^Passage$/ })); expect(pass().className).toMatch(/\bblock\b/); expect(qs().className).toMatch(/\bhidden\b/);
    expect(screen.getByRole('tab', { name: /^Passage$/ }).getAttribute('aria-selected')).toBe('true');
    await u.click(screen.getByRole('tab', { name: /^Questions$/ })); expect(qs().className).toMatch(/\bblock\b/);
    expect((within(card(6)).getByRole('textbox') as HTMLInputElement).value).toBe('common');      // answers survive switching panes
    expect(screen.getAllByRole('timer')).toHaveLength(1);
  });
  it('jumping to a question from the palette switches to the Questions tab', async () => {
    cleanup(); setWidth(390); const u = userEvent.setup(); open(); await screen.findByRole('timer');
    await u.click(screen.getByRole('tab', { name: /^Passage$/ })); await u.click(palette(5));
    await waitFor(() => expect(document.querySelector<HTMLElement>('[data-pane="questions"]')!.className).toMatch(/\bblock\b/));
  });
});

describe('answer secrecy is unchanged by the redesign', () => {
  it('the exam DOM contains no marking data', async () => {
    open(); await screen.findByRole('timer'); const html = document.body.innerHTML;
    for (const banned of ['accepted', 'explanation', 'sawdust'.toUpperCase(), 'correct answer', 'Not Given — not False']) expect(html).not.toContain(banned);
  });
});
