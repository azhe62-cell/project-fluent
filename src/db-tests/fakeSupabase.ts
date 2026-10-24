/**
 * A PostgreSQL-backed stand-in for the supabase-js client.
 *
 * It runs every `rpc()` the adapter makes against REAL PostgreSQL (PGlite) under the same database
 * role PostgREST would use (anon / authenticated / service_role) with the JWT claim set, so grants,
 * RLS, SECURITY DEFINER logic and the SQL functions are exercised for real.
 *
 * What it replaces (and therefore does NOT test): HTTP transport, PostgREST's request parsing,
 * JWT signature verification (the acting user id is simply taken from the actor), CORS, Deno.
 */
import type { PGlite } from '@electric-sql/pglite';
import { submitAttemptHandler, submitPracticeHandler, supabaseDb, type RpcClient } from '@/server';
import type { SupabaseLike } from '@/services/supabase';
import { as, owner, service, type Actor } from './harness';

type Sig = { names: string[]; types: string[] };
const sigCache = new WeakMap<PGlite, Map<string, Sig>>();

async function signature(db: PGlite, fn: string): Promise<Sig> {
  const cache = sigCache.get(db) ?? new Map(); sigCache.set(db, cache);
  if (cache.has(fn)) return cache.get(fn)!;
  const r = await db.query<{ names: string[]; types: string }>(
    `select p.proargnames as names, oidvectortypes(p.proargtypes) as types from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
  if (r.rows.length !== 1) throw Object.assign(new Error(`PGRST202: function ${fn} not found`), { code: 'PGRST202' });
  const sig = { names: r.rows[0].names ?? [], types: r.rows[0].types ? r.rows[0].types.split(', ') : [] };
  cache.set(fn, sig);
  return sig;
}

const arrayLiteral = (a: string[]) => '{' + a.map((x) => '"' + x.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';

export function pgRpc(db: PGlite, actor: Actor): RpcClient['rpc'] {
  return async (fn, args = {}) => {
    try {
      const sig = await signature(db, fn);
      const params = sig.names.map((n, i) => {
        const v = args[n]; const t = sig.types[i];
        if (v === undefined || v === null) return null;
        if (t === 'jsonb') return JSON.stringify(v);
        if (t.endsWith('[]')) return arrayLiteral(v as string[]);
        return v;
      });
      const call = `select ${fn}(${sig.names.map((n, i) => `${n} => $${i + 1}${sig.types[i] === 'jsonb' ? '::jsonb' : ''}`).join(', ')}) as r`;
      const rows = await as(db, actor, (q) => q(call, params));
      return { data: rows[0]?.r ?? null, error: null };
    } catch (e: any) {
      return { data: null, error: { message: String(e?.message ?? e), code: e?.code } };
    }
  };
}

/** Acts as a signed-in learner (actor.kind === 'user') or as anon. */
export function pgClient(db: PGlite, actor: Actor): SupabaseLike {
  const userId = actor.kind === 'user' ? actor.id : null;
  const httpError = (status: number, body: unknown) => ({ data: null, error: { context: { status, json: async () => body } } });
  const run = async (h: typeof submitAttemptHandler, body: unknown) => {
    if (!userId) return httpError(401, { error: 'unauthenticated' });           // no JWT → the Edge Function would reject
    const out = await h(supabaseDb({ rpc: pgRpc(db, service) } as RpcClient), userId, body);
    return out.status >= 200 && out.status < 300 ? { data: out.body, error: null } : httpError(out.status, out.body);
  };
  return {
    rpc: pgRpc(db, actor) as SupabaseLike['rpc'],
    functions: {
      invoke: async (name, opts) => {
        if (name === 'submit-attempt') return run(submitAttemptHandler, opts?.body);
        if (name === 'submit-practice') return run(submitPracticeHandler as typeof submitAttemptHandler, opts?.body);
        if (name === 'delete-account') {
          if (!userId) return httpError(401, {});
          await as(db, owner, (q) => q(`delete from auth.users where id = $1`, [userId]));
          return { data: { ok: true }, error: null };
        }
        return httpError(404, {});
      },
    },
    auth: undefined, from: () => { throw new Error('the adapter must not use direct table access'); },   // enforced: RPC-only
  };
}
