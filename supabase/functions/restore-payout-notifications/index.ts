import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const folderIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const imagePattern = /\.(?:jpe?g|png|webp|heic)$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authorization = req.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const token = authorization.slice('Bearer '.length);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData.user;

  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const [{ data: notifications, error: notificationsError }, { data: transactions, error: transactionsError }, { data: folders, error: foldersError }] = await Promise.all([
      supabase.from('notifications').select('metadata').eq('user_id', user.id).eq('type', 'payout'),
      supabase.from('transactions').select('id').eq('user_id', user.id),
      supabase.storage.from('documents').list(user.id, { limit: 1000 }),
    ]);

    if (notificationsError) throw notificationsError;
    if (transactionsError) throw transactionsError;
    if (foldersError) throw foldersError;

    const knownFolderKeys = new Set(
      (notifications || []).flatMap(({ metadata }) => {
        const data = metadata as Record<string, unknown> | null;
        return [data?.folder_key, data?.transaction_id].filter((value): value is string => typeof value === 'string');
      }),
    );
    const transactionIds = new Set((transactions || []).map(transaction => transaction.id));
    const recovered: Array<Record<string, unknown>> = [];

    for (const folder of folders || []) {
      const folderKey = String(folder.name || '');
      if (!folderIdPattern.test(folderKey) || knownFolderKeys.has(folderKey) || transactionIds.has(folderKey)) continue;

      const { data: files, error: filesError } = await supabase.storage.from('documents').list(`${user.id}/${folderKey}`, { limit: 100 });
      if (filesError) throw filesError;

      // Only restore Dowód wypłaty (expense payout) files. Dowód wpłaty
      // deposit receipts use the separate `dowod_wplaty_` filename and must
      // never appear in this work queue.
      const pdf = (files || []).find(file => /^dowod_wyplaty_.*\.pdf$/i.test(file.name));
      const hasImages = (files || []).some(file => imagePattern.test(file.name));
      if (!pdf || hasImages) continue;

      recovered.push({
        user_id: user.id,
        title: 'Восстановленный расходный ордер без чеков',
        message: 'Документ восстановлен из хранилища. Откройте PDF и добавьте чеки или сохраните операцию.',
        type: 'payout',
        is_read: false,
        metadata: {
          folder_key: folderKey,
          pdf_path: `${user.id}/${folderKey}/${pdf.name}`,
          images_skipped: true,
          recovered_at: new Date().toISOString(),
        },
      });
    }

    if (recovered.length > 0) {
      const { error: insertError } = await supabase.from('notifications').insert(recovered);
      if (insertError) throw insertError;
    }

    return new Response(JSON.stringify({ recovered: recovered.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to restore payout notifications:', error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
