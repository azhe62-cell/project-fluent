// @ts-nocheck — Deno runtime. STATUS: written, NOT executed in this repository's test run.
// Deletes the caller's auth user; every learner table references auth.users ON DELETE CASCADE.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(req, { error: 'unauthenticated' }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) return json(req, { error: 'delete_failed' }, 500);
    return json(req, { ok: true });
  } catch (_e) { return json(req, { error: 'internal_error' }, 500); }
});
