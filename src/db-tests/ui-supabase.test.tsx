// @vitest-environment jsdom
import '../test/setup-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { PGlite } from '@electric-sql/pglite';
import { App } from '@/App';
import { ServicesProvider } from '@/lib/services-context';
import { AuthProvider } from '@/lib/auth-context';
import { SupabaseAssessments } from '@/services/supabase';
import type { AuthService, AuthUser, Services } from '@/services/types';
import { createUser, freshDb, user } from './harness';
import { pgClient } from './fakeSupabase';

/**
 * The REAL UI + the REAL Supabase adapter + REAL PostgreSQL (PGlite). Authentication is a stub that
 * simply says "this learner is signed in" — GoTrue is not exercised here.
 */
let db: PGlite; let path = '';
const Probe = () => { path = useLocation().pathname; return null; };
const stubAuth = (u: AuthUser | null): AuthService => ({
  mode: 'supabase', getUser: async () => u, subscribe: () => () => {},
  signUp: async () => ({ user: u, needsEmailVerification: false }), signIn: async () => u!, signOut: async () => {},
  requestPasswordReset: async () => {}, updatePassword: async () => {}, updateDisplayName: async () => u!, deleteAccount: async () => {},
});
const mount = (id: string | null, at: string) => {
  const u = id ? { id, email: 'ayesha@example.com', displayName: 'Ayesha Khan' } : null;
  const services: Services = { mode: 'supabase', auth: stubAuth(u), assessments: new SupabaseAssessments(pgClient(db, id ? user(id) : { kind: 'anon' })) };
  return render(<MemoryRouter initialEntries={[at]}><ServicesProvider services={services}><AuthProvider><Probe /><App /></AuthProvider></ServicesProvider></MemoryRouter>);
};

beforeAll(async () => { db = await freshDb(); }, 60_000);
afterEach(() => cleanup());
afterAll(async () => { await db.close(); });

describe('Supabase mode: no "local demo" banner, public catalogue works for guests', () => {
  it('guest sees the catalogue from the database and no demo banner', async () => {
    mount(null, '/practice');
    expect(await screen.findByText('Reading Mini-Mock 1')).toBeTruthy();
    expect(screen.queryByText(/local demo mode/i)).toBeNull();
  });
});

describe('the full learner journey on the Supabase adapter', () => {
  it('start → answer → autosave → refresh → submit → report → vault → retry → practice → recommendations', async () => {
    const user_ = userEvent.setup(); const id = await createUser(db, 'ayesha@example.com', 'Ayesha Khan');

    mount(id, '/tests/reading-mini-mock-01');
    expect(await screen.findByRole('heading', { name: 'Reading Mini-Mock 1' })).toBeTruthy();
    for (const l of [/somewhere i can concentrate/i, /uninterrupted minutes/i, /timer won’t pause/i]) await user_.click(screen.getByLabelText(l));
    await user_.click(screen.getByRole('button', { name: /start the test/i }));
    expect(await screen.findByRole('timer')).toBeTruthy();
    const attemptPath = path;

    await user_.click(screen.getByLabelText(/to find out whether roofs could support/i));
    await user_.type(screen.getByLabelText('Answer for question 6'), 'common');
    await screen.findByText('Saved', {}, { timeout: 6000 });
    expect((await db.query<{ n: number }>(`select count(*)::int as n from responses`)).rows[0].n).toBe(2);   // really in PostgreSQL

    cleanup(); mount(id, attemptPath);                                                                       // "refresh"
    expect(await screen.findByRole('timer')).toBeTruthy();
    expect(screen.getByLabelText(/to find out whether roofs could support/i)).toBeChecked();
    expect(screen.getByLabelText('Answer for question 6')).toHaveValue('common');

    await user_.click(screen.getByRole('button', { name: /^submit$/i }));
    const dlg = await screen.findByRole('dialog', { name: /submit your final answers/i });
    await user_.click(within(dlg).getByRole('button', { name: /submit final answers/i }));
    expect(await screen.findByText('Practice marks', {}, { timeout: 10_000 })).toBeTruthy();
    expect(document.body.textContent).toMatch(/2\s*\/\s*20/);
    expect((await db.query<{ n: number }>(`select count(*)::int as n from results`)).rows[0].n).toBe(1);

    // Mistake Vault is AVAILABLE in Supabase mode (no "isn't available" notice)
    await user_.click(screen.getByRole('button', { name: /save 17 to mistake vault/i }));
    expect(await screen.findByText(/saved 17 to your mistake vault/i)).toBeTruthy();
    await user_.click(screen.getByRole('link', { name: /open vault/i }));
    expect(await screen.findByRole('heading', { name: /learn from every miss/i })).toBeTruthy();
    expect(screen.queryByText(/isn’t available with this backend/i)).toBeNull();
    const retry = screen.getAllByRole('button', { name: /retry this question/i });
    expect(retry).toHaveLength(17);

    // Retry one vault question → graded on the server → feedback with explanation
    await user_.click(retry[0]);
    expect(await screen.findByRole('button', { name: /check my answers/i })).toBeTruthy();
    expect(path).toMatch(/^\/practice\/session\//);
    const radios = screen.getAllByRole('radio'); await user_.click(radios[0]);
    await user_.click(screen.getByRole('button', { name: /check my answers/i }));
    expect(await screen.findByText(/you got \d of 1 correct/i, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText(/mistake vault item has been updated/i)).toBeTruthy();
    expect((await db.query<{ n: number }>(`select count(*)::int as n from practice_sessions where status = 'completed'`)).rows[0].n).toBe(1);

    // Recommendations page is real, not a placeholder
    cleanup(); mount(id, '/practice/recommended');
    expect(await screen.findByRole('heading', { name: /recommended for you/i })).toBeTruthy();
    expect(screen.queryByText(/isn’t available with this backend/i)).toBeNull();

    // History lists exactly one scored attempt
    cleanup(); mount(id, '/history');
    expect(await screen.findByRole('heading', { name: /your attempts/i })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Report' })).toHaveLength(1);
  }, 90_000);

  it('another learner sees an empty dashboard — nothing from the first learner leaks', async () => {
    const other = await createUser(db, 'someone-else@example.com', 'Someone Else');
    mount(other, '/mistake-vault');
    expect(await screen.findByText(/your vault is empty/i)).toBeTruthy();
    cleanup(); mount(other, '/history');
    expect(await screen.findByText(/no attempts yet/i)).toBeTruthy();
  });

  it('shows a clear error state (not a blank page) when the backend fails', async () => {
    const id = await createUser(db, 'err@example.com', 'Err');
    const broken: Services = { mode: 'supabase', auth: stubAuth({ id, email: 'err@example.com', displayName: 'Err' }), assessments: new SupabaseAssessments({ rpc: async () => ({ data: null, error: { message: 'Failed to fetch' } }), functions: { invoke: async () => ({ data: null, error: null }) }, auth: null, from: () => null } as any) };
    render(<MemoryRouter initialEntries={['/history']}><ServicesProvider services={broken}><AuthProvider><App /></AuthProvider></ServicesProvider></MemoryRouter>);
    expect(await screen.findByText(/that didn’t load/i)).toBeTruthy();
    expect(screen.getByText(/network problem/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
