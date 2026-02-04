import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface AddImagesRequest {
  token: string;
  transactionId: string;
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

    const body = await req.json() as AddImagesRequest;

    // Validate inputs
    if (!body.token || typeof body.token !== 'string' || body.token.length < 10) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!body.transactionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.transactionId)) {
      return new Response(
        JSON.stringify({ error: 'Invalid transaction ID' }),
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

    // Verify the transaction belongs to the link owner and matches submitter
    const searchPattern = `%[Bez załączników - ${body.submitterName.trim()}]%`;
    
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('id, description')
      .eq('id', body.transactionId)
      .eq('user_id', linkData.owner_user_id)
      .like('description', searchPattern)
      .single();

    if (txError || !transaction) {
      console.log('Transaction not found or access denied');
      return new Response(
        JSON.stringify({ error: 'Transaction not found or access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Remove the "[Bez załączników - Name]" tag from description
    const updatedDescription = transaction.description
      ?.replace(/\s*\[Bez załączników - [^\]]+\]/g, '')
      .trim() || '';

    const { error: updateError } = await supabase
      .from('transactions')
      .update({ 
        description: updatedDescription || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', body.transactionId);

    if (updateError) {
      console.error('Failed to update transaction:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Transaction ${body.transactionId} marked as completed with images`);

    return new Response(
      JSON.stringify({ success: true }),
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
