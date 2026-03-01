import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function sendPdfToOwnerTelegram(
  ownerUserId: string,
  pdfPath: string,
  fileName: string,
  supabase: ReturnType<typeof createClient>
) {
  const { data: telegramUsers } = await supabase
    .from('telegram_users')
    .select('telegram_chat_id, bot_token')
    .eq('user_id', ownerUserId)
    .eq('is_active', true);

  if (!telegramUsers || telegramUsers.length === 0) return;

  const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';

  // Get the PDF bytes from Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('documents')
    .download(pdfPath);

  if (downloadError || !fileData) {
    console.error('Failed to download PDF from storage:', downloadError);
    return;
  }

  const bytes = new Uint8Array(await fileData.arrayBuffer());

  for (const tgUser of telegramUsers) {
    try {
      const botToken = tgUser.bot_token || TELEGRAM_BOT_TOKEN;
      const formData = new FormData();
      formData.append('chat_id', String(tgUser.telegram_chat_id));
      formData.append('caption', `📄 Новый расходный ордер\n${fileName}`);
      formData.append('document', new Blob([bytes], { type: 'application/pdf' }), fileName);

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();
      console.log(`PDF sent to Telegram chat ${tgUser.telegram_chat_id}:`, result.ok);
    } catch (e) {
      console.error(`Failed to send PDF to chat ${tgUser.telegram_chat_id}:`, e);
    }
  }
}

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

    const { token, transactionId, pdfPath, fileName } = await req.json();

    if (!token || !transactionId || !pdfPath) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: token, transactionId, pdfPath' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    // Update notification with pdf_path using service role
    try {
      const { data: notifData } = await supabase
        .from('notifications')
        .select('id, metadata')
        .eq('user_id', linkData.owner_user_id)
        .eq('type', 'payout')
        .order('created_at', { ascending: false })
        .limit(10);

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
                pdf_path: pdfPath,
              },
            })
            .eq('id', targetNotif.id);
          console.log('Notification updated with pdf_path:', pdfPath);
        } else {
          console.log('Target notification not found for transactionId:', transactionId);
        }
      }
    } catch (e) {
      console.error('Notification update failed:', e);
    }

    // Send PDF to Telegram (fire-and-forget)
    sendPdfToOwnerTelegram(
      linkData.owner_user_id,
      pdfPath,
      fileName || 'payout.pdf',
      supabase
    ).catch(e => console.error('Telegram PDF send error:', e));

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
