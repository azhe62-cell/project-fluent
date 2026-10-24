import { NotFoundError, RateLimitedError, type ServerDb } from './db';

/** The only supabase-js surface the server needs (so tests can supply a PostgreSQL-backed stand-in). */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string; code?: string } | null }>;
}

export function supabaseDb(client: RpcClient): ServerDb {
  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      if (error.code === 'P0002' || error.message.includes('not_found')) throw new NotFoundError();
      if (error.code === '54000' || error.message.includes('rate_limited')) throw new RateLimitedError();
      throw new Error(`db:${fn}:${error.code ?? 'error'}`);          // deliberately no SQL text / internals
    }
    return data as T;
  };
  return {
    rateLimit: (userId, bucket, max, windowSeconds) => call('rate_limit_for', { p_user: userId, p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds }),
    finalizeAttempt: (attemptId, userId, kind) => call('finalize_attempt', { p_attempt_id: attemptId, p_user: userId, p_kind: kind }),
    getScoringInputs: (attemptId) => call('get_scoring_inputs', { p_attempt_id: attemptId }),
    storeResult: (attemptId, result, answered) => call('store_result', { p_attempt_id: attemptId, p_result: result, p_answered: answered }),
    getPracticeForGrading: (sessionId, userId) => call('get_practice_for_grading', { p_session_id: sessionId, p_user: userId }),
    getAnswerKeys: (ids) => call('get_answer_keys', { p_question_ids: ids }),
    storePracticeResult: (sessionId, userId, grades, vaultUpdates, answered) =>
      call('store_practice_result', { p_session_id: sessionId, p_user: userId, p_grades: grades, p_vault_updates: vaultUpdates, p_answered: answered }),
  };
}
