import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface AddImagesRequest {
  token: string;
  transactionId: string;
  submitterName: string;
  newPdfPath?: string; // Expected storage path of re-generated PDF (client uploads it)
  // Optional edited fields
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

    // Verify the transaction belongs to the link owner (no description pattern check - too fragile)
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('id, description')
      .eq('id', body.transactionId)
      .eq('user_id', linkData.owner_user_id)
      .single();

    if (txError || !transaction) {
      // Try treating transactionId as a folder_key from a notification (imagesSkipped payout)
      const { data: notif, error: notifErr } = await supabase
        .from('notifications')
        .select('id, metadata')
        .eq('user_id', linkData.owner_user_id)
        .eq('type', 'payout')
        .filter('metadata->>folder_key', 'eq', body.transactionId)
        .maybeSingle();

      if (notifErr || !notif) {
        console.log('Transaction not found or access denied');
        return new Response(
          JSON.stringify({ error: 'Transaction not found or access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create a transaction from notification metadata
      const meta = notif.metadata as Record<string, unknown>;
      const finalDesc = body.updatedBasis !== undefined
        ? body.updatedBasis
        : ((meta.basis as string) || null);

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
        return new Response(
          JSON.stringify({ error: 'Failed to create transaction' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Move storage files from folderKey path to new transactionId path
      try {
        const { data: files } = await supabase.storage
          .from('documents')
          .list(`${linkData.owner_user_id}/${body.transactionId}`);
        if (files && files.length > 0) {
          for (const file of files) {
            const oldPath = `${linkData.owner_user_id}/${body.transactionId}/${file.name}`;
            const newPath = `${linkData.owner_user_id}/${newTx.id}/${file.name}`;
            await supabase.storage.from('documents').move(oldPath, newPath);
          }
        }
      } catch (moveErr) {
        console.warn('Failed to move files (non-critical):', moveErr);
      }

      // Update notification: flip images_skipped=false, set transaction_id
      // Fix PDF path: after moving files, path changes from folderKey to newTx.id
      const correctedPdfPath = body.newPdfPath
        ? body.newPdfPath.replace(`/${body.transactionId}/`, `/${newTx.id}/`)
        : (meta.pdf_path as string | null);
      const updatedMeta = {
        ...(meta as Record<string, unknown>),
        images_skipped: false,
        transaction_id: newTx.id,
        ...(correctedPdfPath ? { pdf_path: correctedPdfPath } : {}),
      };
      await supabase.from('notifications').update({
        metadata: updatedMeta,
        is_read: false,
        created_at: new Date().toISOString(),
      }).eq('id', notif.id);

      console.log(`Created transaction ${newTx.id} from notification folder_key ${body.transactionId}`);
      return new Response(
        JSON.stringify({ success: true, transactionId: newTx.id }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Remove the "[Bez zalacznikow/załączników - Name]" tag from description, use edited basis if provided
    const strippedDescription = transaction.description
      ?.replace(/\s*\[Bez za[łl]a[cć]znik[oó]w - [^\]]+\]/gi, '')
      .trim() || '';
    const finalDescription = body.updatedBasis !== undefined ? body.updatedBasis : strippedDescription;

    const updateData: Record<string, unknown> = {
      description: finalDescription || null,
      updated_at: new Date().toISOString(),
    };
    if (body.updatedIssuedTo !== undefined) updateData['issued_to'] = body.updatedIssuedTo;
    if (body.updatedAmountInWords !== undefined) updateData['amount_in_words'] = body.updatedAmountInWords;
    if (body.updatedDate !== undefined) updateData['date'] = body.updatedDate;
    if (body.updatedAmount !== undefined) updateData['amount'] = body.updatedAmount;
    if (body.updatedCurrency !== undefined) updateData['currency'] = body.updatedCurrency;
    if (body.updatedDecisionNumber !== undefined) updateData['decision_number'] = body.updatedDecisionNumber;
    if (body.updatedDepartmentName !== undefined) updateData['cashier_name'] = body.updatedDepartmentName;
    if (body.updatedCategoryId !== undefined) updateData['category_id'] = body.updatedCategoryId;

    const { error: updateError } = await supabase
      .from('transactions')
      .update(updateData)
      .eq('id', body.transactionId);

    if (updateError) {
      console.error('Failed to update transaction:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Transaction ${body.transactionId} marked as completed with images`);

    // Update the notification: flip images_skipped → false, update pdf_path
    try {
      const { data: notif } = await supabase
        .from('notifications')
        .select('id, metadata')
        .eq('user_id', linkData.owner_user_id)
        .filter('metadata->>transaction_id', 'eq', body.transactionId)
        .maybeSingle();

      if (notif) {
        const updatedMeta = {
          ...(notif.metadata as Record<string, unknown> || {}),
          images_skipped: false,
          ...(body.newPdfPath ? { pdf_path: body.newPdfPath } : {}),
        };
        await supabase
          .from('notifications')
          .update({
            metadata: updatedMeta,
            created_at: new Date().toISOString(),
            is_read: false,
          })
          .eq('id', notif.id);
        console.log(`Notification ${notif.id} updated: images_skipped=false`);
      }
    } catch (notifErr) {
      console.warn('Failed to update notification (non-critical):', notifErr);
    }

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
