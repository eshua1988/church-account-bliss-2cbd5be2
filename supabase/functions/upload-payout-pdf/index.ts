import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
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

    const { token, transactionId, pdfBase64, fileName } = await req.json();

    if (!token || !transactionId || !pdfBase64) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit PDF size (~10MB base64)
    if (pdfBase64.length > 14_000_000) {
      return new Response(
        JSON.stringify({ error: 'PDF too large' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate token
    const { data: linkData, error: linkError } = await supabase
      .from('shared_payout_links')
      .select('owner_user_id, is_active, expires_at')
      .eq('token', token)
      .single();

    if (linkError || !linkData || !linkData.is_active) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired link' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'Link expired' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify transaction belongs to this link owner
    const { data: txData, error: txError } = await supabase
      .from('transactions')
      .select('id, user_id')
      .eq('id', transactionId)
      .eq('user_id', linkData.owner_user_id)
      .single();

    if (txError || !txData) {
      return new Response(
        JSON.stringify({ error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode base64 and upload to storage
    const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
    const storagePath = `${linkData.owner_user_id}/${transactionId}/${fileName || 'payout.pdf'}`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ error: 'Failed to upload PDF' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get signed URL (valid for 30 days)
    const { data: urlData } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30);

    const pdfUrl = urlData?.signedUrl || null;

    // Update the notification with PDF URL
    const { error: notifError } = await supabase
      .from('notifications')
      .update({
        metadata: supabase.rpc ? undefined : undefined, // We'll use raw update
      })
      .eq('user_id', linkData.owner_user_id)
      .eq('type', 'payout')
      .filter('metadata->>transaction_id', 'eq', transactionId);

    // Use direct SQL-style update for JSONB merge
    // Fetch existing notification first
    const { data: notifData } = await supabase
      .from('notifications')
      .select('id, metadata')
      .eq('user_id', linkData.owner_user_id)
      .eq('type', 'payout')
      .order('created_at', { ascending: false })
      .limit(20);

    if (notifData) {
      const targetNotif = notifData.find(
        (n: any) => n.metadata?.transaction_id === transactionId
      );
      if (targetNotif) {
        await supabase
          .from('notifications')
          .update({
            metadata: {
              ...(targetNotif.metadata as Record<string, any>),
              pdf_url: pdfUrl,
              pdf_path: storagePath,
            },
          })
          .eq('id', targetNotif.id);
      }
    }

    console.log('PDF uploaded successfully for transaction:', transactionId);

    return new Response(
      JSON.stringify({ success: true, pdfUrl }),
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
