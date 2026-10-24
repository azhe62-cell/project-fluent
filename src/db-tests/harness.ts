/**
 * Real-PostgreSQL test harness (PGlite = PostgreSQL 16 compiled to WASM, in-process).
 *
 * WHAT THIS IS: the project's actual migrations and seed, executed on a real PostgreSQL engine with
 * roles, grants, RLS, plpgsql and constraints enforced for real.
 * WHAT THIS IS NOT: Supabase. GoTrue (auth), PostgREST (HTTP), Edge runtime and Storage are not
 * present; a tiny shim (supabase/tests/00_supabase_shim.sql) fakes `auth.users` and `auth.uid()`.
 * Passing here proves the SQL/RLS logic; it does not prove a hosted project is configured correctly.
 */
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', 'supabase');
export type Actor = { kind: 'anon' } | { kind: 'user'; id: string } | { kind: 'service' } | { kind: 'owner' };
export const anon: Actor = { kind: 'anon' };
export const service: Actor = { kind: 'service' };
export const owner: Actor = { kind: 'owner' };      // the database owner / dashboard SQL editor
export const user = (id: string): Actor => ({ kind: 'user', id });

export async function freshDb(opts: { seed?: boolean } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(ROOT, 'tests', '00_supabase_shim.sql'), 'utf8'));
  // Test-only: MUTATE the migration text ([from, to] JSON) to prove tests fail when a protection is removed.
  const mut: [string, string] | null = process.env.FLUENT_MUTATION_REPLACE ? JSON.parse(process.env.FLUENT_MUTATION_REPLACE) : null;
  for (const f of readdirSync(join(ROOT, 'migrations')).sort()) {
    let sql = readFileSync(join(ROOT, 'migrations', f), 'utf8');
    if (mut && sql.includes(mut[0])) sql = sql.split(mut[0]).join(mut[1]);
    await db.exec(sql);
  }
  // Test-only hook used by the mutation check (scripts/mutation-check.sh) to prove the tests can fail.
  if (process.env.FLUENT_MUTATION_SQL) await db.exec(process.env.FLUENT_MUTATION_SQL);
  if (opts.seed !== false) await db.exec(readFileSync(join(ROOT, 'seed.sql'), 'utf8'));
  return db;
}

export type Q = <T = Record<string, any>>(sql: string, params?: unknown[]) => Promise<T[]>;

/** Runs `fn` as the given actor inside a transaction (commit on success, rollback on error). */
export async function as<T>(db: PGlite, actor: Actor, fn: (q: Q) => Promise<T>): Promise<T> {
  await db.exec('begin');
  try {
    if (actor.kind === 'anon') {
      await db.exec('set local role anon');
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
    } else if (actor.kind === 'user') {
      await db.exec('set local role authenticated');
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: actor.id, role: 'authenticated' })]);
    } else if (actor.kind === 'service') {
      await db.exec('set local role service_role');
    }
    const q: Q = async (sql, params) => (await db.query(sql, params as any[])).rows as any[];
    const out = await fn(q);
    await db.exec('commit');
    return out;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

export async function createUser(db: PGlite, email: string, displayName = email.split('@')[0]): Promise<string> {
  const r = await db.query<{ id: string }>(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, JSON.stringify({ display_name: displayName })]);
  return r.rows[0].id;
}

export const TEST_ID = 'test-reading-mini-01';
export const BANK_ID = 'test-bank-reading-01';

/** Simulates elapsed time by shifting an attempt's clock back (the DB's now() can't be faked). */
export async function ageAttempt(db: PGlite, attemptId: string, seconds: number) {
  await db.query(`update test_attempts set started_at = started_at - make_interval(secs => $2), deadline_at = deadline_at - make_interval(secs => $2) where id = $1`, [attemptId, seconds]);
}

export const draft = (questionId: string, answer: unknown, seq: number, extra: Record<string, unknown> = {}) => ({ questionId, answer, flagged: false, unsure: false, seq, ...extra });
