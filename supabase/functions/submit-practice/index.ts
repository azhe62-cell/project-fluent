// @ts-nocheck — Deno runtime. Thin shell: authenticate, then delegate to the tested handler.
// STATUS: the handler + database layer are tested against real PostgreSQL (npm run test:db); THIS file
// (JWT verification, CORS, Deno runtime) has not been executed — see docs/STATUS.md.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders, json } from '../_shared/cors.ts';
import { submitPracticeHandler, supabaseDb } from '../_shared/server.js';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    // The user id comes ONLY from the verified JWT — never from the request body.
    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json(req, { error: 'unauthenticated' }, 401);
    const body = await req.json().catch(() => null);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const out = await submitPracticeHandler(supabaseDb(admin), user.id, body);
    return json(req, out.body, out.status);
  } catch (_e) { return json(req, { error: 'internal_error' }, 500); }
});
