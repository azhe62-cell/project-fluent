import { describe, expect, it, vi } from 'vitest';
import { SupabaseAuth, authMessage } from './index';

/**
 * UNIT tests with a scripted FAKE auth client. They verify OUR mapping/handling logic only.
 * They do NOT test GoTrue, e-mail delivery, real sessions or real error payloads from Supabase.
 */
const fake = (over: Record<string, unknown> = {}) => {
  const listeners: Array<(e: string, s: any) => void> = [];
  const auth: any = {
    getSession: vi.fn(async () => ({ data: { session: null } })),
    signUp: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'a@example.com', identities: [{}], user_metadata: { display_name: 'Ada' } }, session: null }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'a@example.com', user_metadata: { display_name: 'Ada' } } }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ data: { user: { id: 'u1', email: 'a@example.com', user_metadata: { display_name: 'Ada' } } }, error: null })),
    onAuthStateChange: vi.fn((cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    ...over,
  };
  return { sb: { auth, rpc: vi.fn(), functions: { invoke: vi.fn() }, from: vi.fn() } as any, auth, listeners };
};
const make = (over?: Record<string, unknown>) => { const f = fake(over); return { ...f, svc: new SupabaseAuth(f.sb, () => 'https://app.example') }; };

describe('registration', () => {
  it('requires e-mail verification when Supabase returns no session, and sends our redirect + display name', async () => {
    const { svc, auth } = make();
    expect(await svc.signUp({ email: 'a@example.com', password: 'a-long-password', displayName: 'Ada' })).toMatchObject({ user: null, needsEmailVerification: true });
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'a@example.com', password: 'a-long-password', options: { data: { display_name: 'Ada' }, emailRedirectTo: 'https://app.example/auth/login' } });
  });
  it('signs the learner straight in when confirmations are off (a session is returned)', async () => {
    const { svc } = make({ signUp: async () => ({ data: { user: { id: 'u1', email: 'a@example.com', identities: [{}], user_metadata: { display_name: 'Ada' } }, session: { access_token: 't' } }, error: null }) });
    expect(await svc.signUp({ email: 'a@example.com', password: 'x'.repeat(12), displayName: 'Ada' })).toMatchObject({ needsEmailVerification: false, user: { id: 'u1', displayName: 'Ada' } });
  });
  it('does not reveal whether an address is already registered (both Supabase behaviours)', async () => {
    const obfuscated = make({ signUp: async () => ({ data: { user: { id: 'fake', identities: [] }, session: null }, error: null }) });
    expect(await obfuscated.svc.signUp({ email: 'taken@example.com', password: 'x'.repeat(12), displayName: 'T' })).toEqual({ user: null, needsEmailVerification: true });
    const explicit = make({ signUp: async () => ({ data: { user: null, session: null }, error: { code: 'user_already_exists', status: 422, message: 'User already registered' } }) });
    expect(await explicit.svc.signUp({ email: 'taken@example.com', password: 'x'.repeat(12), displayName: 'T' })).toEqual({ user: null, needsEmailVerification: true });
  });
  it('surfaces weak-password and rate-limit errors with clear messages', async () => {
    const weak = make({ signUp: async () => ({ data: {}, error: { code: 'weak_password', status: 422, message: 'x' } }) });
    await expect(weak.svc.signUp({ email: 'a@example.com', password: 'password1', displayName: 'A' })).rejects.toMatchObject({ code: 'auth', message: expect.stringMatching(/too weak/i) });
    const rl = make({ signUp: async () => ({ data: {}, error: { code: 'over_email_send_rate_limit', status: 429, message: 'x' } }) });
    await expect(rl.svc.signUp({ email: 'a@example.com', password: 'x'.repeat(12), displayName: 'A' })).rejects.toMatchObject({ message: expect.stringMatching(/too many attempts/i) });
  });
});

describe('sign-in, session restore, sign-out', () => {
  it('signs in and maps the user', async () => { expect(await make().svc.signIn({ email: 'a@example.com', password: 'pw' })).toEqual({ id: 'u1', email: 'a@example.com', displayName: 'Ada' }); });
  it('wrong credentials and unverified e-mail have distinct, helpful messages', async () => {
    const bad = make({ signInWithPassword: async () => ({ data: {}, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } }) });
    await expect(bad.svc.signIn({ email: 'a@example.com', password: 'nope' })).rejects.toMatchObject({ message: 'Email or password is incorrect.' });
    const unv = make({ signInWithPassword: async () => ({ data: {}, error: { code: 'email_not_confirmed', status: 400, message: 'Email not confirmed' } }) });
    await expect(unv.svc.signIn({ email: 'a@example.com', password: 'pw' })).rejects.toMatchObject({ message: expect.stringMatching(/verify your email/i) });
  });
  it('restores a persisted session, and returns null when there is none', async () => {
    expect(await make().svc.getUser()).toBeNull();
    const restored = make({ getSession: async () => ({ data: { session: { user: { id: 'u9', email: 'r@example.com', user_metadata: {} } } } }) });
    expect(await restored.svc.getUser()).toEqual({ id: 'u9', email: 'r@example.com', displayName: 'r' });
  });
  it('subscribers hear sign-in and sign-out; unsubscribe is wired', async () => {
    const { svc, listeners } = make(); const seen: any[] = []; const off = svc.subscribe((u) => seen.push(u?.id ?? null));
    listeners[0]('SIGNED_IN', { user: { id: 'u1', email: 'a@example.com', user_metadata: {} } }); listeners[0]('SIGNED_OUT', null);
    expect(seen).toEqual(['u1', null]); off();
  });
  it('sign-out calls Supabase', async () => { const { svc, auth } = make(); await svc.signOut(); expect(auth.signOut).toHaveBeenCalled(); });
});

describe('password reset', () => {
  it('sends the link to our reset page and never reveals whether the account exists', async () => {
    const { svc, auth } = make();
    await expect(svc.requestPasswordReset('anyone@example.com')).resolves.toBeUndefined();
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('anyone@example.com', { redirectTo: 'https://app.example/auth/reset-password' });
    const missing = make({ resetPasswordForEmail: async () => ({ error: { status: 400, code: 'user_not_found', message: 'x' } }) });
    await expect(missing.svc.requestPasswordReset('ghost@example.com')).resolves.toBeUndefined();
  });
  it('does surface rate limiting', async () => {
    const rl = make({ resetPasswordForEmail: async () => ({ error: { status: 429, code: 'over_email_send_rate_limit', message: 'x' } }) });
    await expect(rl.svc.requestPasswordReset('a@example.com')).rejects.toMatchObject({ code: 'rate_limited' });
  });
  it('updates the password for the recovery session and maps failures', async () => {
    const ok = make(); await ok.svc.updatePassword('a-brand-new-password'); expect(ok.auth.updateUser).toHaveBeenCalledWith({ password: 'a-brand-new-password' });
    const same = make({ updateUser: async () => ({ data: {}, error: { code: 'same_password', status: 422, message: 'x' } }) });
    await expect(same.svc.updatePassword('same')).rejects.toMatchObject({ message: expect.stringMatching(/different/i) });
  });
});

describe('message mapping never leaks raw provider text', () => {
  it('falls back to a generic message and reports network problems', () => {
    expect(authMessage({ code: 'something_new', message: 'internal: db connection string xyz' })).toBe('Something went wrong. Please try again.');
    expect(authMessage({ name: 'AuthRetryableFetchError', status: 0, message: 'fetch failed' })).toMatch(/couldn’t reach the server/);
    expect(authMessage(undefined)).toBe('Something went wrong. Please try again.');
  });
});

describe('account deletion', () => {
  it('invokes the delete-account function then signs out; failure leaves the session intact', async () => {
    const f = make(); f.sb.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null }); await f.svc.deleteAccount();
    expect(f.sb.functions.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' }); expect(f.auth.signOut).toHaveBeenCalled();
    const bad = make(); bad.sb.functions.invoke.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(bad.svc.deleteAccount()).rejects.toMatchObject({ code: 'network' }); expect(bad.auth.signOut).not.toHaveBeenCalled();
  });
});
