import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function sendPdfToOwnerTelegram(
  ownerUserId: string,
  pdfBase64: string,
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

  const binaryStr = atob(pdfBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

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

    const { token, transactionId, pdfBase64, fileName, signatureBase64, images, telegramOnly } = await req.json();

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

    // If telegramOnly mode - skip storage upload, just send via Telegram
    if (telegramOnly) {
      sendPdfToOwnerTelegram(
        linkData.owner_user_id,
        pdfBase64,
        fileName || 'payout.pdf',
        supabase
      ).catch(e => console.error('Telegram PDF send error:', e));
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decode base64 and upload to storage
    const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
    // Sanitize fileName: replace non-ASCII chars and spaces to avoid storage key errors
    const sanitizedFileName = (fileName || 'payout.pdf')
      .replace(/[^\x00-\x7F]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._\-]/g, '_');
    const storagePath = `${linkData.owner_user_id}/${transactionId}/${sanitizedFileName}`;

    // Enforce max 25 PDF files per user — list transaction-id folders, delete oldest
    const { data: folders } = await supabase.storage
      .from('documents')
      .list(linkData.owner_user_id, { sortBy: { column: 'created_at', order: 'asc' } });

    if (folders && folders.length >= 25) {
      const foldersToDelete = folders.slice(0, folders.length - 24);
      for (const folder of foldersToDelete) {
        const { data: files } = await supabase.storage
          .from('documents')
          .list(`${linkData.owner_user_id}/${folder.name}`);
        if (files && files.length > 0) {
          const filePaths = files.map((f: any) => `${linkData.owner_user_id}/${folder.name}/${f.name}`);
          await supabase.storage.from('documents').remove(filePaths);
        }
      }
    }

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

    // Upload signature if provided
    if (signatureBase64) {
      try {
        const sigBytes = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
        await supabase.storage
          .from('documents')
          .upload(`${linkData.owner_user_id}/${transactionId}/signature.png`, sigBytes, {
            contentType: 'image/png',
            upsert: true,
          });
      } catch (e) {
        console.error('Signature upload failed:', e);
      }
    }

    // Upload attached images
    if (images && Array.isArray(images)) {
      for (let i = 0; i < images.length; i++) {
        try {
          const imgData = images[i];
          const imgBytes = Uint8Array.from(atob(imgData.base64), c => c.charCodeAt(0));
          const ext = imgData.mimeType?.includes('png') ? 'png' : 'jpg';
          const imgPath = `${linkData.owner_user_id}/${transactionId}/image_${i + 1}.${ext}`;
          await supabase.storage
            .from('documents')
            .upload(imgPath, imgBytes, {
              contentType: imgData.mimeType || 'image/jpeg',
              upsert: true,
            });
        } catch (e) {
          console.error(`Image ${i + 1} upload failed:`, e);
        }
      }
    }

    // Get signed URL (valid for 30 days)
    const { data: urlData } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30);

    const pdfUrl = urlData?.signedUrl || null;

    // Find notification for this transaction and update with pdf_path
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

    // Send the uploaded PDF to owner via Telegram (fire-and-forget)
    sendPdfToOwnerTelegram(
      linkData.owner_user_id,
      pdfBase64,
      fileName || 'payout.pdf',
      supabase
    ).catch(e => console.error('Telegram PDF send error:', e));

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
