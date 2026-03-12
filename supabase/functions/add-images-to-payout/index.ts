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
      const finalDesc = body.updatedBasis !== undefined ? body.updatedBasis : ((meta.basis as string) || null);

      const { data: newTx, error: newTxErr } = await supabase
        .from('transactions')
        .insert({
          user_id: linkData.owner_user_id,
          type: 'expense',
          amount: body.updatedAmount ?? (meta.amount as number),
          currency: body.updatedCurrency ?? (meta.currency as string),
          category_id: body.updatedCategoryId !== undefined ? body.updatedCategoryId : (meta.category_id as string | null) || null,
          description: finalDesc,
          date: body.updatedDate ?? (meta.date as string) ?? new Date().toISOString().split('T')[0],
          issued_to: body.updatedIssuedTo ?? (meta.issued_to as string) ?? (meta.submitter_name as string) ?? null,
          amount_in_words: body.updatedAmountInWords ?? (meta.amount_in_words as string) ?? null,
          decision_number: body.updatedDecisionNumber ?? (meta.decision_number as string) ?? null,
          cashier_name: body.updatedDepartmentName ?? (meta.department_name as string) ?? null,
        })
        .select('id')
        .single();

      if (newTxErr || !newTx) {
        console.error('Failed to create transaction from notification:', newTxErr);
        return new Response(JSON.stringify({ error: 'Failed to create transaction' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      try {
        const { data: files } = await supabase.storage.from('documents').list(`${linkData.owner_user_id}/${body.transactionId}`);
        if (files && files.length > 0) {
          for (const file of files) {
            await supabase.storage.from('documents').move(
              `${linkData.owner_user_id}/${body.transactionId}/${file.name}`,
              `${linkData.owner_user_id}/${newTx.id}/${file.name}`
            );
          }
        }
      } catch (moveErr) {
        console.warn('Failed to move files (non-critical):', moveErr);
      }

      // Build the PDF path on the server side (client doesn't know owner_user_id)
      const pdfDate = body.updatedDate || new Date().toISOString().split('T')[0];
      const pdfFileName = `dowod_wyplaty_${pdfDate}_${newTx.id.substring(0, 8)}.pdf`;
      const uploadPdfPath = `${linkData.owner_user_id}/${newTx.id}/${pdfFileName}`;

      await supabase.from('notifications').update({
        metadata: {
          ...(meta as Record<string, unknown>),
          images_skipped: false,
          transaction_id: newTx.id,
          pdf_path: uploadPdfPath,
        },
        is_read: false,
        created_at: new Date().toISOString(),
      }).eq('id', notif.id);

      console.log(`Created transaction ${newTx.id} from folder_key ${body.transactionId}, uploadPdfPath=${uploadPdfPath}`);
      return new Response(
        JSON.stringify({ success: true, transactionId: newTx.id, uploadPdfPath }),
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
        // Build PDF path server-side so the anonymous client doesn't need owner_user_id
        const pdfDate = body.updatedDate || new Date().toISOString().split('T')[0];
        const pdfFileName = `dowod_wyplaty_${pdfDate}_${body.transactionId.substring(0, 8)}.pdf`;
        const uploadPdfPath = `${linkData.owner_user_id}/${body.transactionId}/${pdfFileName}`;
        await supabase.from('notifications').update({
          metadata: {
            ...(notif.metadata as Record<string, unknown> || {}),
            images_skipped: false,
            pdf_path: uploadPdfPath,
          },
          created_at: new Date().toISOString(),
          is_read: false,
        }).eq('id', notif.id);
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