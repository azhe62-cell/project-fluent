import { createClient, type User } from '@supabase/supabase-js';
import { pickFreshForVault, recommendPractice, type Attempt, type PublicTest, type ResponseDraft, type ResultView, type SkillTag, type SubmissionKind } from '@/engine';
import type { AnswerRecord } from '@/engine/recommend';
import type { ActivityEvent } from '@/engine/streak';
import type { VaultItem } from '@/engine/vault';
import {
  ServiceError, type AssessmentService, type AttemptSession, type AuthService, type AuthUser, type PracticeContent, type PracticeSession,
  type SaveResult, type Services, type TestSummary,
} from '../types';

/**
 * SUPABASE ADAPTER — all data access is RPC (SECURITY DEFINER functions in supabase/migrations) plus two
 * Edge Functions for trusted work (scoring / practice grading). No table embedding, no client-side scoring.
 * Tested: against real PostgreSQL through a PostgreSQL-backed client stand-in (src/db-tests).
 * NOT tested: supabase-js HTTP transport, PostgREST, GoTrue — see docs/STATUS.md.
 */

// ---- the slice of supabase-js we use (lets tests substitute a PostgreSQL-backed stand-in) ----
type RpcResult = PromiseLike<{ data: any; error: any }>;
export interface SupabaseLike {
  rpc(fn: string, args?: Record<string, unknown>): RpcResult;
  functions: { invoke(name: string, opts?: { body?: unknown; method?: string }): Promise<{ data: any; error: any }> };
  auth: any;
  from(table: string): any;
}

const toUser = (u: User): AuthUser => ({
  id: u.id, email: u.email ?? '',
  displayName: (u.user_metadata?.display_name as string | undefined) ?? (u.email ?? 'Learner').split('@')[0],
});

/** Maps a Postgres/PostgREST error to a ServiceError with a learner-safe message (never raw SQL text). */
export function rpcError(e: { message?: string; code?: string; name?: string } | null | undefined): ServiceError {
  const m = e?.message ?? '', c = e?.code ?? '';
  if (c === '28000' || m.includes('unauthenticated') || c === 'PGRST301') return new ServiceError('unauthenticated', 'Your session has expired. Please sign in again.');
  if (c === 'P0002' || m.includes('not_found') || m.includes('test_not_available')) return new ServiceError('not_found', 'That item is not available.');
  if (c === '54000' || m.includes('rate_limited')) return new ServiceError('rate_limited', 'You’re going a little fast. Please wait a moment and try again.');
  if (c === '55000' || m.includes('not_final')) return new ServiceError('conflict', 'That can only be done after the attempt has been submitted.');
  if (m.includes('not_fresh')) return new ServiceError('no_fresh_question', 'That question isn’t new for you any more.');
  if (c === '22023' || m.includes('invalid_')) return new ServiceError('invalid', 'That request wasn’t valid.');
  if (!c && /fetch|network|timeout|failed to/i.test(m)) return new ServiceError('network', 'Network problem. Please check your connection and try again.');
  return new ServiceError('invalid', 'The request could not be completed. Please try again.');
}

/** Reads the JSON body of a failed Edge Function call and maps it. */
async function fnError(error: any): Promise<ServiceError> {
  const status: number | undefined = error?.context?.status;
  let body: any = null;
  try { body = await error?.context?.json?.(); } catch { /* not JSON */ }
  if (status === 401) return new ServiceError('unauthenticated', 'Your session has expired. Please sign in again.');
  if (status === 404) return new ServiceError('not_found', 'That item is not available.');
  if (status === 429) return new ServiceError('rate_limited', 'You’re going a little fast. Please wait a moment and try again.');
  if (status === 400 && (body?.error === 'empty' || body?.error === 'invalid')) return new ServiceError(body.error, body.message ?? 'Please check your answers.');
  return new ServiceError('network', 'We couldn’t reach the server. Your answers are saved — please try again.');
}

/** Learner-safe messages for GoTrue errors. Sign-up deliberately never reveals whether an email exists. */
export function authMessage(e: { code?: string; status?: number; message?: string; name?: string } | null | undefined): string {
  const code = e?.code ?? '';
  if (code === 'invalid_credentials') return 'Email or password is incorrect.';
  if (code === 'email_not_confirmed') return 'Please verify your email address first — check your inbox for the confirmation link.';
  if (code === 'weak_password') return 'That password is too weak. Use at least 10 characters and avoid common passwords.';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || e?.status === 429) return 'Too many attempts. Please wait a minute and try again.';
  if (code === 'signup_disabled') return 'New sign-ups are currently turned off.';
  if (code === 'validation_failed' || code === 'email_address_invalid') return 'Please enter a valid email address.';
  if (code === 'same_password') return 'Choose a password different from your current one.';
  if (e?.name === 'AuthRetryableFetchError' || e?.status === 0 || /fetch|network/i.test(e?.message ?? '')) return 'We couldn’t reach the server. Please check your connection and try again.';
  if (code === 'session_not_found' || code === 'refresh_token_not_found') return 'Your session has expired. Please sign in again.';
  return 'Something went wrong. Please try again.';
}

export class SupabaseAuth implements AuthService {
  mode = 'supabase' as const;
  constructor(private sb: SupabaseLike, private origin: () => string = () => window.location.origin) {}

  async getUser() {
    const { data } = await this.sb.auth.getSession();                     // restores the persisted session
    return data?.session ? toUser(data.session.user) : null;
  }
  subscribe(cb: (u: AuthUser | null) => void) {
    const { data } = this.sb.auth.onAuthStateChange((_event: string, s: { user: User } | null) => cb(s ? toUser(s.user) : null));
    return () => data.subscription.unsubscribe();
  }
  async signUp(i: { email: string; password?: string; displayName: string }) {
    const { data, error } = await this.sb.auth.signUp({
      email: i.email, password: i.password ?? '',
      options: { data: { display_name: i.displayName }, emailRedirectTo: `${this.origin()}/auth/login` },
    });
    if (error) {
      if (error.code === 'user_already_exists') return { user: null, needsEmailVerification: true };     // no account enumeration
      throw new ServiceError('auth', authMessage(error));
    }
    // With e-mail confirmation on and an address that already exists, Supabase returns an obfuscated user with no identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return { user: null, needsEmailVerification: true };
    return { user: data.session ? toUser(data.user) : null, needsEmailVerification: !data.session };
  }
  async signIn(i: { email: string; password?: string }) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: i.email, password: i.password ?? '' });
    if (error) throw new ServiceError('auth', authMessage(error));
    return toUser(data.user);
  }
  async signOut() { await this.sb.auth.signOut(); }
  async requestPasswordReset(email: string) {
    // The outcome is never revealed (same UI whether or not the address exists); only rate-limit errors surface.
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: `${this.origin()}/auth/reset-password` });
    if (error && (error.status === 429 || String(error.code).includes('rate_limit'))) throw new ServiceError('rate_limited', authMessage(error));
  }
  async updatePassword(password: string) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new ServiceError('auth', authMessage(error));
  }
  async updateDisplayName(name: string) {
    const { data: s } = await this.sb.auth.getSession();
    if (!s?.session) throw new ServiceError('unauthenticated', 'Not signed in.');
    const { error } = await this.sb.from('profiles').update({ display_name: name.trim() }).eq('id', s.session.user.id);
    if (error) throw new ServiceError('invalid', 'Could not update your name.');
    const { data, error: e2 } = await this.sb.auth.updateUser({ data: { display_name: name.trim() } });
    if (e2) throw new ServiceError('invalid', 'Could not update your name.');
    return toUser(data.user);
  }
  async deleteAccount() {
    const { error } = await this.sb.functions.invoke('delete-account', { method: 'POST' });
    if (error) throw new ServiceError('network', 'Could not delete the account. Please try again.');
    await this.sb.auth.signOut();
  }
}

const summarise = (c: { id: string; slug: string; title: string; description: string; assessmentType: PublicTest['assessmentType']; currentVersion: number; content: PublicTest }): TestSummary => ({
  id: c.id, slug: c.slug, title: c.title, description: c.description, assessmentType: c.assessmentType,
  durationSeconds: c.content.durationSeconds, questionCount: c.content.questions.length,
  totalMarks: c.content.questions.reduce((a, q) => a + q.marks, 0), version: c.currentVersion, passageCount: c.content.passages.length,
});

export class SupabaseAssessments implements AssessmentService {
  mode = 'supabase' as const;
  capabilities = { assessments: true, vault: true, practice: true };
  constructor(private sb: SupabaseLike) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    let r: { data: any; error: any };
    try { r = await this.sb.rpc(fn, args); } catch (e) { throw rpcError({ message: e instanceof Error ? e.message : String(e) }); }
    if (r.error) throw rpcError(r.error);
    return r.data as T;
  }

  // ---- catalogue
  private catalogue() { return this.rpc<any[]>('list_catalogue'); }
  async listTests(): Promise<TestSummary[]> { return (await this.catalogue()).map(summarise); }
  async getTest(slug: string) { return ((await this.catalogue()).find((c) => c.slug === slug)?.content as PublicTest | undefined) ?? null; }

  // ---- attempts
  private toSession(p: any): AttemptSession {
    return { attempt: p.attempt as Attempt, test: p.content as PublicTest, responses: p.responses as Record<string, ResponseDraft>, serverNow: p.serverNow };
  }
  async startOrResumeAttempt(testId: string) { return this.toSession(await this.rpc('start_or_resume_attempt', { p_test_id: testId })); }
  async getAttempt(attemptId: string) { const p = await this.rpc<any>('get_attempt', { p_attempt_id: attemptId }); return p ? this.toSession(p) : null; }
  async saveResponses(attemptId: string, drafts: ResponseDraft[]): Promise<SaveResult> {
    try { return await this.rpc<SaveResult>('save_responses', { p_attempt_id: attemptId, p_items: drafts }); }
    catch (e) {
      if (e instanceof ServiceError && e.code === 'not_found') return { serverNow: new Date().toISOString(), applied: 0, stale: 0, rejected: [], fatal: 'forbidden' };
      throw e;                                   // transient (network, rate limit) → the autosave queue retries with back-off
    }
  }
  async submitAttempt(attemptId: string, kind: SubmissionKind): Promise<ResultView> {
    const { data, error } = await this.sb.functions.invoke('submit-attempt', { body: { attemptId, kind } });
    if (error) throw await fnError(error);
    if (!data || data.error) throw new ServiceError('network', 'We couldn’t confirm your submission yet. Your answers are saved — please try again.');
    return data as ResultView;
  }
  async getResult(attemptId: string) {
    const stored = await this.rpc<ResultView | null>('get_result', { p_attempt_id: attemptId });
    if (stored) return stored;
    // Finalised but never scored (abandoned past its deadline, or a crash between finalise and store): complete it now (idempotent).
    const s = await this.getAttempt(attemptId);
    if (s && (s.attempt.status === 'expired' || s.attempt.status === 'submitted')) return this.submitAttempt(attemptId, s.attempt.status === 'expired' ? 'time_expired' : 'learner_submitted');
    return null;
  }
  listResults() { return this.rpc<ResultView[]>('list_my_results'); }
  listAttempts() { return this.rpc<Attempt[]>('list_my_attempts'); }

  // ---- Mistake Vault
  listVault() { return this.rpc<VaultItem[]>('list_my_vault'); }
  addToVault(attemptId: string, questionIds?: string[]) { return this.rpc<{ added: number; skipped: number }>('add_to_vault', { p_attempt_id: attemptId, p_question_ids: questionIds ?? null }); }
  selfRateVaultItem(id: string, rating: 'understood' | 'needs_practice') { return this.rpc<VaultItem>('self_rate_vault_item', { p_id: id, p_rating: rating }); }

  // ---- targeted practice
  private bank() { return this.rpc<{ passages: unknown[]; questions: any[] }>('get_practice_bank'); }
  async getRecommendations() {
    const [bank, records, vault] = await Promise.all([this.bank(), this.getAnswerRecords(), this.listVault()]);
    return recommendPractice({ records, bank: bank.questions, vault });
  }
  async createPracticeSession(i: { mode: PracticeSession['mode']; skill?: SkillTag; questionIds?: string[]; vaultItemId?: string }): Promise<PracticeSession> {
    let ids: string[] | null = i.questionIds ?? null;
    if (i.mode === 'vault_fresh') {
      const [vault, bank, records] = await Promise.all([this.listVault(), this.bank(), this.getAnswerRecords()]);
      const item = vault.find((v) => v.id === i.vaultItemId);
      if (!item) throw new ServiceError('not_found', 'Vault item not found.');
      const pick = pickFreshForVault(item, bank.questions, new Set(records.map((r) => r.questionId)));
      if (!pick) throw new ServiceError('no_fresh_question', 'You have already seen every practice question for this skill — more content is needed.');
      ids = [pick.id];                            // the server re-checks bank membership, skill overlap and freshness
    }
    return this.rpc<PracticeSession>('create_practice_session', { p_mode: i.mode, p_skill: i.skill ?? null, p_question_ids: ids, p_vault_item_id: i.vaultItemId ?? null });
  }
  getPracticeSession(id: string) { return this.rpc<PracticeContent | null>('get_practice_session', { p_id: id }); }
  async submitPracticeSession(id: string, answers: Record<string, any>): Promise<PracticeSession> {
    const { data, error } = await this.sb.functions.invoke('submit-practice', { body: { sessionId: id, answers } });
    if (error) throw await fnError(error);
    if (!data || data.error) throw new ServiceError('network', 'We couldn’t reach the server. Please try again.');
    return data as PracticeSession;
  }

  getAnswerRecords() { return this.rpc<AnswerRecord[]>('get_answer_records'); }
  getActivity() { return this.rpc<ActivityEvent[]>('list_my_activity'); }
}

export function createSupabaseServices(): Services {
  const sb = createClient(import.meta.env.VITE_SUPABASE_URL!, import.meta.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }) as unknown as SupabaseLike;
  return { mode: 'supabase', auth: new SupabaseAuth(sb), assessments: new SupabaseAssessments(sb) };
}
