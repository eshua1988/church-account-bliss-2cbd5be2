import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface CheckPendingRequest {
  token: string;
  submitterName: string;
  transactionId?: string; // Optional: fetch a specific transaction by ID directly
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

    // If transactionId is provided, fetch that specific transaction directly (skip name search)
    if (body.transactionId) {
      const { data: tx, error: txErr } = await supabase
        .from('transactions')
        .select('id, amount, currency, description, date, issued_to, amount_in_words, category_id, cashier_name, created_at')
        .eq('id', body.transactionId)
        .eq('user_id', linkData.owner_user_id)
        .single();

      if (txErr || !tx) {
        return new Response(
          JSON.stringify({ success: true, pendingPayouts: [] }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Enrich with PDF URL
      let pdfUrl: string | null = null;
      try {
        const { data: files } = await supabase.storage.from('documents').list(`${linkData.owner_user_id}/${tx.id}`);
        const pdfFile = files?.find((f: { name: string }) => f.name.endsWith('.pdf'));
        if (pdfFile) {
          const { data: signed } = await supabase.storage
            .from('documents')
            .createSignedUrl(`${linkData.owner_user_id}/${tx.id}/${pdfFile.name}`, 3600);
          pdfUrl = signed?.signedUrl || null;
        }
      } catch (_) { /* ignore */ }

      return new Response(
        JSON.stringify({ success: true, pendingPayouts: [{ ...tx, pdfUrl }] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Search for transactions without images for this submitter
    const normalizedName = body.submitterName.trim().replace(/\s+/g, ' ');
    const nameParts = normalizedName.split(' ');
    
    console.log(`Searching pending payouts for: "${normalizedName}"`);
    
    // Fetch ALL transactions with the [Bez zalacznikow] marker for this owner
    // Then filter by name match in code (avoids PostgREST special-char issues with [ ] in patterns)
    const { data: allPending, error: txError } = await supabase
      .from('transactions')
      .select('id, amount, currency, description, date, issued_to, amount_in_words, category_id, cashier_name, created_at')
      .eq('user_id', linkData.owner_user_id)
      .eq('type', 'expense')
      .ilike('description', '%Bez zalacznikow%')
      .order('created_at', { ascending: false })
      .limit(50);

    if (txError) {
      console.error('Error fetching transactions:', txError);
      return new Response(
        JSON.stringify({ error: 'Failed to check pending payouts' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter by submitter name (case-insensitive, partial match on first+last name)
    const firstNameLower = nameParts[0]?.toLowerCase() || '';
    const lastNameLower = nameParts[nameParts.length - 1]?.toLowerCase() || '';
    
    const pendingTransactions = (allPending || []).filter(tx => {
      const descLower = (tx.description || '').toLowerCase();
      const issuedLower = (tx.issued_to || '').toLowerCase();
      const normalizedLower = normalizedName.toLowerCase();
      
      // Match by description marker containing the name
      const descMatch = nameParts.length >= 2
        ? descLower.includes(firstNameLower) && descLower.includes(lastNameLower)
        : descLower.includes(normalizedLower);
      
      // Match by issued_to field
      const issuedMatch = nameParts.length >= 2
        ? issuedLower.includes(firstNameLower) && issuedLower.includes(lastNameLower)
        : issuedLower.includes(normalizedLower);
      
      return descMatch || issuedMatch;
    }).slice(0, 10);

    console.log(`Found ${pendingTransactions?.length || 0} pending transactions for ${body.submitterName}`);

    // Enrich with PDF URLs from storage
    const enrichedPayouts = await Promise.all(
      (pendingTransactions || []).map(async (tx) => {
        try {
          const { data: files } = await supabase.storage
            .from('documents')
            .list(`${linkData.owner_user_id}/${tx.id}`);
          const pdfFile = files?.find((f: { name: string }) => f.name.endsWith('.pdf'));
          if (pdfFile) {
            const { data: signed } = await supabase.storage
              .from('documents')
              .createSignedUrl(`${linkData.owner_user_id}/${tx.id}/${pdfFile.name}`, 3600);
            return { ...tx, pdfUrl: signed?.signedUrl || null };
          }
        } catch (_) { /* ignore */ }
        return { ...tx, pdfUrl: null };
      })
    );

    return new Response(
      JSON.stringify({ 
        success: true, 
        pendingPayouts: enrichedPayouts
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
