import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface AddImagesRequest {
  token: string;
  transactionId: string;
  submitterName: string;
  newPdfPath?: string;
  updatedBasis?: string;
  updatedIssuedTo?: string;
  updatedAmountInWords?: string;
  updatedDate?: string;
  updatedAmount?: number;
  updatedCurrency?: string;
  updatedDecisionNumber?: string;
  updatedDepartmentName?: string;
  updatedCategoryId?: string | null;
}

async function sendPushNotification(supabaseUrl: string, serviceKey: string, notificationId: string) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notification_id: notificationId, url: '/church-account-bliss-2cbd5be2/' }),
    });

    if (!response.ok) {
      console.warn('Push notification request failed:', response.status, await response.text());
    }
  } catch (error) {
    console.warn('Push notification request failed:', error);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json() as AddImagesRequest;

    if (!body.token || typeof body.token !== 'string' || body.token.length < 10) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!body.transactionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.transactionId)) {
      return new Response(JSON.stringify({ error: 'Invalid transaction ID' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!body.submitterName || typeof body.submitterName !== 'string' || body.submitterName.trim().length < 2) {
      return new Response(JSON.stringify({ error: 'Invalid submitter name' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: linkData, error: linkError } = await supabase
      .from('shared_payout_links')
      .select('id, owner_user_id, is_active, expires_at')
      .eq('token', body.token)
      .single();

    if (linkError || !linkData) {
      return new Response(JSON.stringify({ error: 'Invalid or expired link' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!linkData.is_active) {
      return new Response(JSON.stringify({ error: 'This link is no longer active' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('id, description')
      .eq('id', body.transactionId)
      .eq('user_id', linkData.owner_user_id)
      .single();

    if (txError || !transaction) {
      // images_skipped payout -- folder_key path
      const { data: notif, error: notifErr } = await supabase
        .from('notifications')
        .select('id, metadata')
        .eq('user_id', linkData.owner_user_id)
        .eq('type', 'payout')
        .filter('metadata->>folder_key', 'eq', body.transactionId)
        .maybeSingle();

      if (notifErr || !notif) {
        console.log('Transaction not found or access denied');
        return new Response(JSON.stringify({ error: 'Transaction not found or access denied' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const meta = notif.metadata as Record<string, unknown>;
      const metaWithoutPushState = { ...meta };
      delete metaWithoutPushState.push_sent_at;
      delete metaWithoutPushState.push_sent_count;

      // Update metadata fields from the form (amount, date, etc.) — user may have edited them
      const updatedMeta: Record<string, unknown> = {
        ...metaWithoutPushState,
        images_skipped: false,
      };
      if (body.updatedBasis !== undefined) updatedMeta['basis'] = body.updatedBasis;
      if (body.updatedIssuedTo !== undefined) updatedMeta['issued_to'] = body.updatedIssuedTo;
      if (body.updatedAmountInWords !== undefined) updatedMeta['amount_in_words'] = body.updatedAmountInWords;
      if (body.updatedDate !== undefined) updatedMeta['date'] = body.updatedDate;
      if (body.updatedAmount !== undefined) updatedMeta['amount'] = body.updatedAmount;
      if (body.updatedCurrency !== undefined) updatedMeta['currency'] = body.updatedCurrency;
      if (body.updatedDecisionNumber !== undefined) updatedMeta['decision_number'] = body.updatedDecisionNumber;
      if (body.updatedDepartmentName !== undefined) updatedMeta['department_name'] = body.updatedDepartmentName;
      if (body.updatedCategoryId !== undefined) updatedMeta['category_id'] = body.updatedCategoryId;

      // Files stay in the folder_key folder — no transaction created yet (owner clicks "В расход" manually)
      // Build PDF path using folder_key as the folder
      const pdfDate = body.updatedDate || (meta.date as string) || new Date().toISOString().split('T')[0];
      const pdfFileName = `dowod_wyplaty_${pdfDate}_${body.transactionId.substring(0, 8)}.pdf`;
      const uploadPdfPath = `${linkData.owner_user_id}/${body.transactionId}/${pdfFileName}`;
      updatedMeta['pdf_path'] = uploadPdfPath;

      await supabase.from('notifications').update({
        metadata: updatedMeta,
        is_read: false,
        created_at: new Date().toISOString(),
      }).eq('id', notif.id);

      await sendPushNotification(supabaseUrl, supabaseServiceKey, notif.id);

      console.log(`Marked folder_key ${body.transactionId} as images added (no auto-transaction), uploadPdfPath=${uploadPdfPath}`);
      return new Response(
        JSON.stringify({ success: true, uploadPdfPath }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Existing transaction flow
    const strippedDescription = transaction.description
      ?.replace(/\s*\[Bez za[łl]a[cć]znik[oó]w - [^\]]+\]/gi, '').trim() || '';
    const finalDescription = body.updatedBasis !== undefined ? body.updatedBasis : strippedDescription;

    const updateData: Record<string, unknown> = { description: finalDescription || null, updated_at: new Date().toISOString() };
    if (body.updatedIssuedTo !== undefined) updateData['issued_to'] = body.updatedIssuedTo;
    if (body.updatedAmountInWords !== undefined) updateData['amount_in_words'] = body.updatedAmountInWords;
    if (body.updatedDate !== undefined) updateData['date'] = body.updatedDate;
    if (body.updatedAmount !== undefined) updateData['amount'] = body.updatedAmount;
    if (body.updatedCurrency !== undefined) updateData['currency'] = body.updatedCurrency;
    if (body.updatedDecisionNumber !== undefined) updateData['decision_number'] = body.updatedDecisionNumber;
    if (body.updatedDepartmentName !== undefined) updateData['cashier_name'] = body.updatedDepartmentName;
    if (body.updatedCategoryId !== undefined) updateData['category_id'] = body.updatedCategoryId;

    const { error: updateError } = await supabase.from('transactions').update(updateData).eq('id', body.transactionId);
    if (updateError) {
      console.error('Failed to update transaction:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to update transaction' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Transaction ${body.transactionId} marked as completed with images`);

    try {
      const { data: notif } = await supabase
        .from('notifications')
        .select('id, metadata')
        .eq('user_id', linkData.owner_user_id)
        .filter('metadata->>transaction_id', 'eq', body.transactionId)
        .maybeSingle();

      if (notif) {
        const metaWithoutPushState = { ...(notif.metadata as Record<string, unknown> || {}) };
        delete metaWithoutPushState.push_sent_at;
        delete metaWithoutPushState.push_sent_count;
        // Build PDF path server-side so the anonymous client doesn't need owner_user_id
        const pdfDate = body.updatedDate || new Date().toISOString().split('T')[0];
        const pdfFileName = `dowod_wyplaty_${pdfDate}_${body.transactionId.substring(0, 8)}.pdf`;
        const uploadPdfPath = `${linkData.owner_user_id}/${body.transactionId}/${pdfFileName}`;
        await supabase.from('notifications').update({
          metadata: {
            ...metaWithoutPushState,
            images_skipped: false,
            pdf_path: uploadPdfPath,
          },
          created_at: new Date().toISOString(),
          is_read: false,
        }).eq('id', notif.id);
        await sendPushNotification(supabaseUrl, supabaseServiceKey, notif.id);
        console.log(`Notification ${notif.id} updated: images_skipped=false, pdf_path=${uploadPdfPath}`);
        return new Response(
          JSON.stringify({ success: true, uploadPdfPath }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (notifErr) {
      console.warn('Failed to update notification (non-critical):', notifErr);
    }

    return new Response(
      JSON.stringify({ success: true, uploadPdfPath: undefined }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
