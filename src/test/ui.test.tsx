// @vitest-environment jsdom
import './setup-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from '@/App';
import { ServicesProvider } from '@/lib/services-context';
import { AuthProvider } from '@/lib/auth-context';
import { createLocalServices } from '@/services/local';
import { MemoryStore } from '@/services/local/storage';

let store: MemoryStore;
let path = '';
const Probe = () => { path = useLocation().pathname + useLocation().search; return null; };

const mount = (initial: string) => {
  const services = createLocalServices(store);
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <ServicesProvider services={services}><AuthProvider><Probe /><App /></AuthProvider></ServicesProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => { store = new MemoryStore(); path = ''; });
afterEach(() => cleanup());

describe('public pages', () => {
  it('landing page: honest copy, working CTAs, no invented social proof', async () => {
    mount('/');
    expect(await screen.findByRole('heading', { level: 1, name: /practice like it counts/i })).toBeInTheDocumentLike();
    expect(screen.getByRole('link', { name: /start practicing/i })).toHaveAttribute('href', '/practice');
    expect(screen.getByRole('link', { name: /explore how it works/i })).toHaveAttribute('href', '/how-it-works');
    expect(screen.getAllByText(/free means free/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not affiliated with/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/demonstration data/i)).toBeTruthy();
    // Honest status labels: only Reading is live
    expect(screen.getAllByText('In development')).toHaveLength(3);
    expect(screen.getAllByText('Available now')).toHaveLength(1);
    // Nothing that looks like fabricated proof
    // ("no premium tier" is an honest negation, so strip it before looking for premium claims)
    const body = (document.body.textContent ?? '').replace(/no premium tier/gi, '');
    for (const banned of [/testimonial/i, /\d+,?\d*\+? (students|learners|users)/i, /5-star|rated \d/i, /band score guarantee/i, /\bpremium\b/i, /subscribe/i, /upgrade/i, /\$\d/]) expect(body).not.toMatch(banned);
  });

  it('the sample question grades in the browser and explains', async () => {
    const user = userEvent.setup();
    mount('/sample');
    const card = await screen.findByText(/the night market clock/i);
    expect(card).toBeTruthy();
    const check = screen.getByRole('button', { name: /answer both to check/i });
    expect(check).toBeDisabled();
    const groups = screen.getAllByRole('radiogroup');
    await user.click(within(groups[0]).getByLabelText('False'));
    await user.click(within(groups[1]).getByLabelText('True')); // wrong on purpose (answer is Not Given)
    await user.click(screen.getByRole('button', { name: /check my answers/i }));
    expect(await screen.findByText(/you got 1 of 2/i)).toBeTruthy();
    expect(screen.getByText(/never reports what residents thought/i)).toBeTruthy();
  });

  it('catalogue lists the published test without requiring an account', async () => {
    mount('/practice');
    expect(await screen.findByText('Reading Mini-Mock 1')).toBeTruthy();
    expect(screen.getByRole('link', { name: /view & start/i })).toHaveAttribute('href', '/tests/reading-mini-mock-01');
    expect(screen.getAllByText(/not yet available|in development|coming next/i).length).toBeGreaterThan(0);
  });

  it('unknown routes show a helpful 404', async () => {
    mount('/nope/nothing');
    expect(await screen.findByRole('heading', { name: /couldn’t find that page/i })).toBeTruthy();
  });
});

describe('route protection', () => {
  for (const target of ['/dashboard', '/tests/reading-mini-mock-01', '/mistake-vault', '/history', '/admin', '/attempts/abc']) {
    it(`signed-out visitors to ${target} are sent to sign-in and the destination is remembered`, async () => {
      mount(target);
      expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeTruthy();
      expect(path).toBe(`/auth/login?next=${encodeURIComponent(target)}`);
    });
  }
  it('rejects open-redirect style destinations after sign-in', async () => {
    const user = userEvent.setup();
    mount('/auth/register?next=' + encodeURIComponent('//evil.example'));
    await user.type(await screen.findByLabelText(/display name/i), 'Sana');
    await user.type(screen.getByLabelText(/^email/i), 'sana@example.com');
    await user.click(screen.getByLabelText(/i agree to the/i));
    await user.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(path).toBe('/dashboard'));
  });
});

describe('registration validation', () => {
  it('shows accessible errors and does not create an account', async () => {
    const user = userEvent.setup();
    mount('/auth/register');
    await user.type(await screen.findByLabelText(/email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/enter a valid email/i)).toBeTruthy();
    expect(screen.getByText(/at least 2 characters/i)).toBeTruthy();
    expect(screen.getByText(/accept the terms/i)).toBeTruthy();
    expect(screen.getByLabelText(/^email/i)).toHaveAttribute('aria-invalid', 'true');
    expect(path).toBe('/auth/register');
  });
});

describe('the exam journey (local adapter, real screens)', () => {
  it('register → start → answer → autosave → reload → submit → report → vault', async () => {
    const user = userEvent.setup();

    // 1. register and land on the intended destination
    mount('/auth/register?next=' + encodeURIComponent('/tests/reading-mini-mock-01'));
    await user.type(await screen.findByLabelText(/display name/i), 'Ayesha Khan');
    await user.type(screen.getByLabelText(/^email/i), 'ayesha@example.com');
    await user.click(screen.getByLabelText(/i agree to the/i));
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByRole('heading', { name: 'Reading Mini-Mock 1' })).toBeTruthy();
    expect(path).toBe('/tests/reading-mini-mock-01');

    // 2. readiness check gates the start button
    const start = screen.getByRole('button', { name: /start the test/i });
    expect(start).toBeDisabled();
    for (const l of [/somewhere i can concentrate/i, /uninterrupted minutes/i, /timer won’t pause/i]) await user.click(screen.getByLabelText(l));
    expect(start).toBeEnabled();
    await user.click(start);

    // 3. exam screen: timer, passage, questions, navigator
    expect(await screen.findByRole('timer', { name: /time remaining/i })).toBeTruthy();
    expect(screen.getByText('The Rooftop Meadow Experiment', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: /question navigator/i })).toBeTruthy();
    expect(screen.getByText(/0 of 19 answered/i)).toBeTruthy();
    const attemptPath = path;
    expect(attemptPath).toMatch(/^\/attempts\//);

    // 4. answer, see it autosave
    await user.click(screen.getByLabelText(/to find out whether roofs could support/i));
    await user.type(screen.getByLabelText('Answer for question 6'), 'common');
    expect(screen.getByText(/2 of 19 answered/i)).toBeTruthy();
    await screen.findByText('Saved', {}, { timeout: 5000 });

    // 5. "refresh": tear everything down, remount at the same URL over the same storage
    cleanup();
    mount(attemptPath);
    expect(await screen.findByRole('timer')).toBeTruthy();
    expect(screen.getByLabelText(/to find out whether roofs could support/i)).toBeChecked();
    expect(screen.getByLabelText('Answer for question 6')).toHaveValue('common');
    expect(screen.getByText(/2 of 19 answered/i)).toBeTruthy();

    // 6. flag + submit through the confirmation dialog
    await user.click(screen.getAllByRole('button', { name: /flag for review/i })[0]);
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    const dlg = await screen.findByRole('dialog', { name: /submit your final answers/i });
    expect(within(dlg).getByText(/17 unanswered/i)).toBeTruthy();
    await user.click(within(dlg).getByRole('button', { name: /submit final answers/i }));

    // 7. report derived from the saved attempt
    expect(await screen.findByText('Practice marks', {}, { timeout: 8000 })).toBeTruthy();
    expect(path).toMatch(/^\/results\//);
    const stats = document.body.textContent ?? '';
    expect(stats).toMatch(/2\s*\/\s*20/);               // q01 + q06
    expect(screen.getAllByText(/unanswered/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/independent estimates, not official results/i)).toBeTruthy();

    // 8. save mistakes to the vault, then review them there
    await user.click(screen.getByRole('button', { name: /save 17 to mistake vault/i }));
    expect(await screen.findByText(/saved 17 to your mistake vault/i)).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /open vault/i }));
    expect(await screen.findByRole('heading', { name: /learn from every miss/i })).toBeTruthy();
    expect(screen.getByText(/how mastery works/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /retry this question/i }).length).toBe(17);

    // 9. history shows the one attempt, once
    await user.click(screen.getAllByRole('link', { name: /history/i })[0]);
    expect(await screen.findByRole('heading', { name: /your attempts/i })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Report' })).toHaveLength(1);
  }, 40_000);

  it('a different learner on the same device cannot open that attempt', async () => {
    const user = userEvent.setup();
    const services = createLocalServices(store);
    await services.auth.signUp({ email: 'a@example.com', displayName: 'Alice' });
    const s = await services.assessments.startOrResumeAttempt('test-reading-mini-01');
    await services.auth.signOut();
    await services.auth.signUp({ email: 'b@example.com', displayName: 'Bilal' });
    render(
      <MemoryRouter initialEntries={[`/attempts/${s.attempt.id}`]}>
        <ServicesProvider services={services}><AuthProvider><App /></AuthProvider></ServicesProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/couldn’t find that attempt/i)).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
    void user;
  });
});
