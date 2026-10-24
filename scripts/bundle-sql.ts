/**
 * Concatenates every migration + the seed into ONE file for the Supabase SQL editor (no CLI/Docker needed).
 *   npm run db:bundle   →   supabase/setup_all.sql
 * Run it ONCE on a fresh project. It is not idempotent: re-running it on a database that already has the
 * tables will fail harmlessly at the first CREATE TABLE. It contains no DROP / TRUNCATE / reset statements.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../supabase/', import.meta.url);
const parts = readdirSync(new URL('migrations/', dir)).sort().map((f) => `-- ===== migrations/${f} =====\n` + readFileSync(new URL(`migrations/${f}`, dir), 'utf8'));
parts.push('-- ===== seed.sql =====\n' + readFileSync(new URL('seed.sql', dir), 'utf8'));
const sql = parts.join('\n\n');
if (/\b(drop\s+(table|schema|database)|truncate)\b/i.test(sql)) throw new Error('Refusing to bundle destructive statements');
writeFileSync(new URL('setup_all.sql', dir), sql);
console.log(`setup_all.sql written (${parts.length} parts, ${sql.length} bytes, no destructive statements)`);
