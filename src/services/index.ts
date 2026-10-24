import type { Services } from './types';

export const isSupabaseConfigured = () =>
  !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

let cached: Promise<Services> | null = null;

/**
 * Chooses the backend once. Both adapters are dynamically imported so that, in a
 * Supabase deployment, the local adapter — and with it the answer keys — never ships
 * in the browser bundle's main chunk.
 */
export function getServices(): Promise<Services> {
  cached ??= isSupabaseConfigured()
    ? import('./supabase').then((m) => m.createSupabaseServices())
    : import('./local').then((m) => m.createLocalServices());
  return cached;
}
