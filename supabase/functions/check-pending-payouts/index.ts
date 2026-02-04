import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface CheckPendingRequest {
  token: string;
  submitterName: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json() as CheckPendingRequest;

    // Validate inputs
    if (!body.token || typeof body.token !== 'string' || body.token.length < 10) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!body.submitterName || typeof body.submitterName !== 'string' || body.submitterName.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: 'Invalid submitter name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate token and get owner
    const { data: linkData, error: linkError } = await supabase
      .from('shared_payout_links')
      .select('id, owner_user_id, is_active, expires_at')
      .eq('token', body.token)
      .single();

    if (linkError || !linkData) {
      console.log('Invalid token:', linkError?.message);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired link' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!linkData.is_active) {
      return new Response(
        JSON.stringify({ error: 'This link is no longer active' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'This link has expired' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Search for transactions without images for this submitter
    // Pattern: [Bez załączników - Name Surname]
    const searchPattern = `%[Bez załączników - ${body.submitterName.trim()}]%`;
    
    const { data: pendingTransactions, error: txError } = await supabase
      .from('transactions')
      .select('id, amount, currency, description, date, issued_to, amount_in_words, category_id, created_at')
      .eq('user_id', linkData.owner_user_id)
      .eq('type', 'expense')
      .like('description', searchPattern)
      .order('created_at', { ascending: false })
      .limit(10);

    if (txError) {
      console.error('Error fetching transactions:', txError);
      return new Response(
        JSON.stringify({ error: 'Failed to check pending payouts' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${pendingTransactions?.length || 0} pending transactions for ${body.submitterName}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        pendingPayouts: pendingTransactions || []
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
