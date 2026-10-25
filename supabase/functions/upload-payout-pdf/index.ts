import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createR2SignedUrl, downloadFromR2, isR2Configured, r2ObjectExists } from "../_shared/r2.ts";

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

  // New files live in R2. Keep the Storage fallback until the historic files
  // have been migrated, so no existing receipt becomes unavailable.
  let fileData: Blob | null = null;
  try {
    if (isR2Configured()) fileData = await downloadFromR2(pdfPath);
  } catch (error) {
    console.warn('R2 PDF download failed, trying legacy Storage:', error);
  }
  if (!fileData) {
    const { data, error } = await supabase.storage.from('documents').download(pdfPath);
    if (error || !data) {
      console.error('Failed to download PDF from storage:', error);
      return;
    }
    fileData = data;
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
    // GET requests: action=sign (download URL), action=upload-url (existing
    // path) or action=prepare-upload (new anonymous public-payout upload).
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action');
      const filePath = url.searchParams.get('filePath');

      if (!filePath && action !== 'prepare-upload') {
        return new Response(JSON.stringify({ error: 'Missing filePath' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      if (action === 'upload-url' || action === 'prepare-upload') {
        // Require a valid payout link token — derive userId from it (client never knows userId)
        const linkToken = url.searchParams.get('token');
        if (!linkToken) {
          return new Response(JSON.stringify({ error: 'Missing token' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const { data: linkData, error: linkErr } = await supabase
          .from('shared_payout_links')
          .select('owner_user_id, is_active')
          .eq('token', linkToken)
          .single();
        if (linkErr || !linkData?.is_active) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const isPreparedUpload = action === 'prepare-upload';
        const safeFileName = String(url.searchParams.get('fileName') || 'dowod_wyplaty.pdf')
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 160) || 'dowod_wyplaty.pdf';
        const folderKey = crypto.randomUUID();
        const resolvedFilePath = isPreparedUpload
          ? `${linkData.owner_user_id}/${folderKey}/${safeFileName}`
          : filePath!;

        // Validate an existing path belongs to the token owner. Prepared
        // uploads always receive a new server-generated path.
        if (!resolvedFilePath.startsWith(linkData.owner_user_id + '/')) {
          console.error('filePath does not belong to token owner:', filePath, linkData.owner_user_id);
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (isR2Configured()) {
          try {
            const contentType = 'application/pdf';
            const r2SignedUrl = await createR2SignedUrl(resolvedFilePath, 'PUT', { contentType });
            return new Response(JSON.stringify({
              r2SignedUrl,
              path: resolvedFilePath,
              filePath: resolvedFilePath,
              contentType,
              ...(isPreparedUpload ? { folderKey } : {}),
            }), {
              status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          } catch (error) {
            // A secret may be temporarily unavailable or a new R2 key may not
            // have propagated yet. Do not prevent a payout from being sent.
            console.error('R2 upload URL failed, using legacy Storage:', error);
          }
        }

        // Legacy Storage fallback during the migration.
        const { data, error } = await supabase.storage
          .from('documents')
          .createSignedUploadUrl(resolvedFilePath, { upsert: true });

        if (error || !data) {
          console.error('createSignedUploadUrl error:', error);
          return new Response(JSON.stringify({ error: error?.message || 'Failed to create upload URL' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({
          signedUrl: data.signedUrl,
          token: data.token,
          path: data.path,
          filePath: resolvedFilePath,
          ...(isPreparedUpload ? { folderKey } : {}),
        }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'sign') {
        const userId = url.searchParams.get('userId');
        if (!userId) {
          return new Response(JSON.stringify({ error: 'Missing userId' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (!filePath.startsWith(userId + '/') && !filePath.startsWith(userId + '%2F')) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (isR2Configured()) {
          try {
            if (await r2ObjectExists(filePath)) {
              const signedUrl = await createR2SignedUrl(filePath, 'GET', { expiresInSeconds: 3600 });
              return new Response(JSON.stringify({ signedUrl }), {
                status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
          } catch (error) {
            // A missing historic object must still be served from Supabase.
            console.warn('R2 signed URL failed, trying legacy Storage:', error);
          }
        }

        const { data, error } = await supabase.storage
          .from('documents')
          .createSignedUrl(filePath, 3600);

        if (error || !data?.signedUrl) {
          console.error('createSignedUrl error:', error, 'filePath:', filePath);
          return new Response(JSON.stringify({ error: error?.message || 'Failed to create signed URL' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ signedUrl: data.signedUrl }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'download') {
        const userId = url.searchParams.get('userId');
        if (!userId || !filePath.startsWith(userId + '/')) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        let fileData: Blob | null = null;
        try {
          if (isR2Configured()) fileData = await downloadFromR2(filePath);
        } catch (error) {
          console.warn('R2 download failed, trying legacy Storage:', error);
        }
        if (!fileData) {
          const { data, error } = await supabase.storage.from('documents').download(filePath);
          if (error || !data) {
            return new Response(JSON.stringify({ error: error?.message || 'File not found' }), {
              status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          fileData = data;
        }

        const fileName = filePath.split('/').pop() || 'document.pdf';
        return new Response(fileData.stream(), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
            'Cache-Control': 'no-store',
          },
        });
      }

      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
      // Search directly by transaction_id in metadata using filter
      const { data: notifData, error: notifError } = await supabase
        .from('notifications')
        .select('id, metadata')
        .eq('user_id', linkData.owner_user_id)
        .eq('type', 'payout')
        .filter('metadata->>transaction_id', 'eq', transactionId)
        .limit(1);

      if (notifError) {
        console.error('Notification query error:', notifError);
      }

      const targetNotif = notifData?.[0];
      if (targetNotif) {
        const { error: updateError } = await supabase
          .from('notifications')
          .update({
            metadata: {
              ...(targetNotif.metadata as Record<string, any>),
              pdf_path: pdfPath,
            },
          })
          .eq('id', targetNotif.id);
        if (updateError) {
          console.error('Notification update error:', updateError);
        } else {
          console.log('Notification updated with pdf_path:', pdfPath);
        }
      } else {
        // Fallback: retry once after 2 seconds (notification may not be created yet)
        await new Promise(r => setTimeout(r, 2000));
        const { data: retryData } = await supabase
          .from('notifications')
          .select('id, metadata')
          .eq('user_id', linkData.owner_user_id)
          .eq('type', 'payout')
          .filter('metadata->>transaction_id', 'eq', transactionId)
          .limit(1);
        const retryNotif = retryData?.[0];
        if (retryNotif) {
          await supabase
            .from('notifications')
            .update({
              metadata: {
                ...(retryNotif.metadata as Record<string, any>),
                pdf_path: pdfPath,
              },
            })
            .eq('id', retryNotif.id);
          console.log('Notification updated with pdf_path (retry):', pdfPath);
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
