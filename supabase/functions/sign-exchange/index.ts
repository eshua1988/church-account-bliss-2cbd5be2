// Edge Function: sign-exchange
// POST /sign-exchange         { sid, data_url }  → stores signature
// GET  /sign-exchange?sid=... → returns { data_url } or { data_url: null }
// DELETE /sign-exchange?sid=... → deletes entry

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const url = new URL(req.url);
  const sid = url.searchParams.get('sid');

  try {
    if (req.method === 'POST') {
      const { sid: bodySid, data_url } = await req.json();
      if (!bodySid || !data_url) {
        return new Response(JSON.stringify({ error: 'Missing sid or data_url' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await supabase.from('temp_signatures').upsert({ sid: bodySid, data_url });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET') {
      if (!sid) {
        return new Response(JSON.stringify({ error: 'Missing sid' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data } = await supabase
        .from('temp_signatures')
        .select('data_url')
        .eq('sid', sid)
        .maybeSingle();
      return new Response(JSON.stringify({ data_url: data?.data_url ?? null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'DELETE') {
      if (!sid) {
        return new Response(JSON.stringify({ error: 'Missing sid' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      await supabase.from('temp_signatures').delete().eq('sid', sid);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
