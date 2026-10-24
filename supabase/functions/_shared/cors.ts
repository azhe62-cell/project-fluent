// CORS limited to the configured origin (set ALLOWED_ORIGIN, e.g. https://your-domain.example).
export const corsHeaders = (req: Request) => {
  const allowed = Deno.env.get('ALLOWED_ORIGIN') ?? '';
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowed && origin === allowed ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
};
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
