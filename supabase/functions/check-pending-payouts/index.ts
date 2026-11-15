import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createR2SignedUrl, isR2Configured, r2ObjectExists } from "../_shared/r2.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface CheckPendingRequest {
  token: string;
  submitterName: string;
  transactionId?: string; // Optional: fetch a specific transaction by ID directly
  amount?: number;
  date?: string;
}

const transliterateForFilename = (value: string) => {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
    А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'Yo', Ж: 'Zh', З: 'Z', И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'Kh', Ц: 'Ts', Ч: 'Ch', Ш: 'Sh', Щ: 'Shch', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'Yu', Я: 'Ya',
  };
  return value.split('').map((character) => map[character] ?? character).join('')
    .replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'dokument';
};

const getPdfUrl = async (supabase: ReturnType<typeof createClient>, path: string) => {
  if (isR2Configured()) {
    try {
      if (await r2ObjectExists(path)) {
        return await createR2SignedUrl(path, 'GET', { expiresInSeconds: 3600 });
      }
    } catch (error) {
      console.warn('Unable to find PDF in R2:', error);
    }
  }

  const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600);
  return data?.signedUrl || null;
};

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

    // Also search notifications with images_skipped=true and no transaction_id (payout without photo)
    const { data: pendingNotifs } = await supabase
      .from('notifications')
      .select('id, metadata, created_at')
      .eq('user_id', linkData.owner_user_id)
      .eq('type', 'payout')
      .order('created_at', { ascending: false })
      .limit(50);

    const amountForVerification = typeof body.amount === 'number' && !Number.isNaN(body.amount) ? body.amount : null;
    const recentSubmissionExists = amountForVerification !== null
      ? (pendingNotifs || []).some(n => {
          const meta = n.metadata as Record<string, unknown>;
          const createdAt = new Date(n.created_at).getTime();
          const isRecent = Number.isFinite(createdAt) && Date.now() - createdAt < 10 * 60 * 1000;
          const submitterLower = ((meta?.submitter_name as string) || (meta?.issued_to as string) || '').toLowerCase();
          const nameLower = normalizedName.toLowerCase();
          const nameMatch = nameParts.length >= 2
            ? submitterLower.includes(firstNameLower) && submitterLower.includes(lastNameLower)
            : submitterLower.includes(nameLower);
          const amountMatch = Number(meta?.amount) === amountForVerification;
          const dateMatch = !body.date || meta?.date === body.date;
          return isRecent && nameMatch && amountMatch && dateMatch;
        })
      : false;

    // Filter: images_skipped=true, no transaction_id, name matches
    const notifPayouts = (pendingNotifs || [])
      .filter(n => {
        const meta = n.metadata as Record<string, unknown>;
        if (!meta?.images_skipped) return false;
        if (meta?.transaction_id) return false; // already added to transactions
        const submitterLower = ((meta?.submitter_name as string) || (meta?.issued_to as string) || '').toLowerCase();
        const nameLower = normalizedName.toLowerCase();
        const nameMatch = nameParts.length >= 2
          ? submitterLower.includes(firstNameLower) && submitterLower.includes(lastNameLower)
          : submitterLower.includes(nameLower);
        return nameMatch;
      })
      .map(n => {
        const meta = n.metadata as Record<string, unknown>;
        return {
          id: meta.folder_key as string,          // folder_key used as id
          amount: meta.amount as number,
          currency: meta.currency as string,
          description: (meta.basis as string) || null,
          date: (meta.date as string) || n.created_at.split('T')[0],
          issued_to: (meta.issued_to as string) || (meta.submitter_name as string) || null,
          amount_in_words: (meta.amount_in_words as string) || null,
          category_id: (meta.category_id as string) || null,
          cashier_name: (meta.department_name as string) || null,
          bank_account: (meta.bank_account as string) || null,
          created_at: n.created_at,
          pdfUrl: null as string | null,
          source: 'notification',  // marker to distinguish from transaction-based
        };
      });

    // Get signed PDF URLs for notification-based payouts
    await Promise.all(notifPayouts.map(async (p) => {
      try {
        const notification = pendingNotifs?.find(n => (n.metadata as Record<string, unknown>).folder_key === p.id);
        const meta = notification?.metadata as Record<string, unknown> | undefined;
        const storedPath = meta?.pdf_path as string | undefined;
        const date = (meta?.date as string) || p.date;
        const issuedTo = (meta?.issued_to as string) || (meta?.submitter_name as string) || p.issued_to || '';
        const legacyPath = `${linkData.owner_user_id}/${p.id}/dowod_wyplaty_${date}_${transliterateForFilename(issuedTo)}.pdf`;

        for (const pdfPath of [storedPath, legacyPath].filter((path): path is string => Boolean(path))) {
          const signedUrl = await getPdfUrl(supabase, pdfPath);
          if (!signedUrl) continue;

          p.pdfUrl = signedUrl;
          // Old uploads did not always store their path in metadata. Persist it
          // once found so future receipt additions always retain the signed PDF.
          if (!storedPath && notification) {
            await supabase.from('notifications').update({
              metadata: { ...(meta || {}), pdf_path: pdfPath },
            }).eq('id', notification.id);
          }
          break;
        }
      } catch (_) { /* ignore */ }
    }));

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
        pendingPayouts: [...enrichedPayouts, ...notifPayouts],
        recentSubmissionExists,
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
