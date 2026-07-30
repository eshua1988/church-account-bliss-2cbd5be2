import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface PublicTransactionsRequest {
  token: string;
  includeNotifications?: boolean;
  action?: 'add-rule-terms' | 'sync-bank' | 'analytics' | 'export-sheets' | 'save-sheets-settings' | 'save-registration-source' | 'delete-registration-source' | 'reconcile-registration-sheets';
  fromDate?: string;
  cursor?: {
    date: string;
    createdAt: string;
    id: string;
  };
  terms?: string[];
  transactionTypes?: Array<'income' | 'expense'>;
  transactionIds?: string[];
  spreadsheetId?: string;
  sheetName?: string;
  sheetRange?: string;
  sourceId?: string;
  nameColumns?: string;
}

type RegistrationSource = { id: string; spreadsheet_id: string; sheet_name: string; sheet_range: string; name_columns: string };

const transliteration: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', ё: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
};
const normalizePerson = (value: unknown) => String(value || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .split('').map(char => transliteration[char] ?? char).join('')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const lettersToIndex = (column: string) => column.split('').reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
const sourceRange = (source: Pick<RegistrationSource, 'sheet_name' | 'sheet_range'>) => {
  const name = source.sheet_name.replace(/'/g, "''");
  return source.sheet_name ? `'${name}'!${source.sheet_range}` : source.sheet_range;
};

const OTHER_DEPARTMENT_BY_TYPE = {
  income: 'Прочее (доход)',
  expense: 'Прочее (расход)',
} as const;

const normalizeTerm = (term: string) => term.trim().replace(/\s+/g, ' ');

const parseTerms = (terms: unknown) => {
  const source = Array.isArray(terms) ? terms : [];
  const seen = new Set<string>();

  return source
    .flatMap((term) => String(term || '').split(','))
    .map(normalizeTerm)
    .filter((term) => {
      if (!term || term.length < 2) return false;
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const sendPushNotification = async (supabaseUrl: string, serviceKey: string, notificationId: string) => {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notification_id: notificationId, url: '/church-account-bliss-2cbd5be2/' }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn('Push notification request failed:', response.status, result);
      return { sent: 0, error: `HTTP ${response.status}`, result };
    }
    return result || { sent: 0 };
  } catch (error) {
    console.warn('Push notification request failed:', error);
    return { sent: 0, error: String(error) };
  }
};

const findRuleDepartment = (tx: any, rules: any[] = []) => {
  if (tx.department_name) return tx.department_name;

  const title = String(tx.bank_title || '').toLowerCase();
  const desc = String(tx.description || '').toLowerCase();

  const rule = rules.find((rule) => {
    if (rule.transaction_type && rule.transaction_type !== tx.type) return false;
    const searchTerms = String(rule.search_text || '')
      .split(',')
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);
    return searchTerms.some((term) => title.includes(term) || desc.includes(term));
  });

  return rule?.department_name || null;
};

const getOtherRuleSearchTerms = (rules: any[] = []) => {
  const result = {
    income: [] as string[],
    expense: [] as string[],
  };

  for (const type of ['income', 'expense'] as const) {
    const departmentName = OTHER_DEPARTMENT_BY_TYPE[type];
    const seen = new Set<string>();

    for (const rule of rules) {
      if (rule.transaction_type !== type || rule.department_name !== departmentName) continue;

      String(rule.search_text || '')
        .split(',')
        .map((term) => normalizeTerm(term))
        .filter(Boolean)
        .forEach((term) => {
          const key = term.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            result[type].push(term);
          }
        });
    }
  }

  return result;
};

const getPendingRuleSearchTerms = (notifications: any[] = []) => {
  const result = {
    income: [] as string[],
    expense: [] as string[],
  };
  const seen = {
    income: new Set<string>(),
    expense: new Set<string>(),
  };

  for (const notification of notifications) {
    const metadata = notification?.metadata || {};
    if (metadata.request_type !== 'department_rule_terms') continue;

    const terms = parseTerms(metadata.terms);
    const requestedTypes = Array.isArray(metadata.transaction_types)
      ? metadata.transaction_types.filter((type: unknown) => type === 'income' || type === 'expense')
      : [];
    const transactionTypes = requestedTypes.length > 0 ? Array.from(new Set(requestedTypes)) : ['income', 'expense'];

    for (const type of transactionTypes as Array<'income' | 'expense'>) {
      for (const term of terms) {
        const key = term.toLowerCase();
        if (seen[type].has(key)) continue;
        seen[type].add(key);
        result[type].push(term);
      }
    }
  }

  return result;
};

const cleanBankText = (value: unknown) =>
  String(value || '')
    .replace(/(?:\d{4}\s*)?OD:\s*\d+\s+DO:\s*\d+\s+MOBILE-PAYMENT-C2C\b/gi, ' ')
    .replace(/OD:\s*[\d*]+\s+DO:\s*[\d*]+(?=\s|$|[.,;])/gi, ' ')
    .replace(/\bPRZELEW\s+NA\s+TELEFON\s+[\d*]+\.?/gi, ' ')
    .replace(/\b\d{4}\s+\d{10,}\s+MOBILE-PAYMENT-ATM-TX-CODE\b/gi, ' ')
    .replace(/(^|\s)(?:TRANSFER[-_\s]?(?:IN|OUT)|MOBILE-PAYMENT-C2C-EXTERNAL)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mapTransaction = (tx: any, rules: any[] = []) => ({
  id: tx.id,
  type: tx.type,
  category: tx.category_id || 'other',
  amount: Number(tx.amount),
  currency: tx.currency,
  description: cleanBankText(tx.bank_title) || cleanBankText(tx.description),
  date: tx.date,
  createdAt: tx.created_at,
  issuedTo: tx.issued_to || undefined,
  decisionNumber: tx.decision_number || undefined,
  amountInWords: tx.amount_in_words || undefined,
  cashierName: tx.cashier_name || undefined,
  bankTitle: cleanBankText(tx.bank_title) || undefined,
  bankSender: tx.bank_sender || undefined,
  bankRecipient: tx.bank_recipient || undefined,
  source: tx.source || undefined,
  departmentName: findRuleDepartment(tx, rules) || undefined,
  comment: tx.comment || undefined,
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ valid: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json() as PublicTransactionsRequest;
    const token = body.token?.trim();

    if (!token || token.length < 10 || token.length > 100) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Invalid token format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: linkData, error: linkError } = await supabase
      .from('shared_transaction_links')
      .select('id, owner_user_id, token, is_active, expires_at')
      .eq('token', token)
      .single();

    if (linkError || !linkData || !linkData.is_active) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Link not found or inactive' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Link expired' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (body.action === 'save-registration-source') {
      const input = String(body.spreadsheetId || '').trim();
      const spreadsheetId = (input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || input).trim();
      const sheetName = String(body.sheetName || '').trim();
      const sheetRange = String(body.sheetRange || 'A:Z').trim().toUpperCase();
      const nameColumns = String(body.nameColumns || 'A:B').trim().toUpperCase();
      if (!/^[a-zA-Z0-9_-]{20,200}$/.test(spreadsheetId) || !/^[A-Z]+(?::[A-Z]+|[0-9]+:[A-Z]+[0-9]+)?$/.test(sheetRange) || !/^[A-Z]+(?::[A-Z]+)?$/.test(nameColumns)) {
        return new Response(JSON.stringify({ valid: true, success: false, error: 'Проверьте ссылку, диапазон листа и колонки с именем.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const record = { owner_user_id: linkData.owner_user_id, spreadsheet_id: spreadsheetId, sheet_name: sheetName, sheet_range: sheetRange, name_columns: nameColumns };
      // Adding an already configured sheet updates its name columns instead of
      // failing on the unique source constraint. This makes correcting A:Z → C:C easy.
      const query = body.sourceId && /^[0-9a-f-]{36}$/i.test(body.sourceId)
        ? supabase.from('registration_sheet_sources').update(record).eq('id', body.sourceId).eq('owner_user_id', linkData.owner_user_id).select().single()
        : supabase.from('registration_sheet_sources').upsert(record, {
            onConflict: 'owner_user_id,spreadsheet_id,sheet_name,sheet_range',
          }).select().single();
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ valid: true, success: true, source: data }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'delete-registration-source') {
      if (!body.sourceId || !/^[0-9a-f-]{36}$/i.test(body.sourceId)) throw new Error('Invalid source ID');
      const { error } = await supabase.from('registration_sheet_sources').delete().eq('id', body.sourceId).eq('owner_user_id', linkData.owner_user_id);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ valid: true, success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'reconcile-registration-sheets') {
      const [{ data: sources, error: sourceError }, { data: transactions, error: transactionError }] = await Promise.all([
        supabase.from('registration_sheet_sources').select('id, spreadsheet_id, sheet_name, sheet_range, name_columns').eq('owner_user_id', linkData.owner_user_id),
        supabase.from('transactions').select('id, date, amount, currency, bank_sender, bank_recipient, bank_title, description, comment').eq('user_id', linkData.owner_user_id).eq('type', 'income').order('date', { ascending: false }).limit(3000),
      ]);
      if (sourceError || transactionError) throw new Error(sourceError?.message || transactionError?.message);
      let matched = 0;
      for (const source of (sources || []) as RegistrationSource[]) {
        const read = await fetch(`${supabaseUrl}/functions/v1/google-sheets`, { method: 'POST', headers: { Authorization: `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json', 'x-owner-user-id': linkData.owner_user_id }, body: JSON.stringify({ action: 'read', spreadsheetId: source.spreadsheet_id, range: sourceRange(source) }) });
        const result = await read.json().catch(() => ({}));
        if (!read.ok) throw new Error(result?.error || `Не удалось прочитать лист ${source.sheet_name}`);
        const values: string[][] = result.values || [];
        const columns = source.name_columns.split(':').map(lettersToIndex);
        const marks = values.slice(1).flatMap((row, index) => {
          const person = normalizePerson(columns.map(column => row[column] || '').join(' '));
          const nameTokens = person.split(' ').filter(token => token.length >= 3);
          if (nameTokens.length < 2) return [];
          const tx = (transactions || []).find(transaction => {
            const text = normalizePerson([transaction.bank_sender, transaction.bank_recipient, transaction.bank_title, transaction.description, transaction.comment].join(' '));
            return nameTokens.every(token => text.includes(token));
          });
          if (!tx) return [];
          matched += 1;
          return [{ row: index + 2, nameColumn: columns[0], note: `Найдена транзакция: ${tx.date} — ${tx.amount} ${tx.currency || ''}. ${tx.bank_title || tx.description || ''}`.trim() }];
        });
        if (marks.length) {
          const mark = await fetch(`${supabaseUrl}/functions/v1/google-sheets`, { method: 'POST', headers: { Authorization: `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json', 'x-owner-user-id': linkData.owner_user_id }, body: JSON.stringify({ action: 'mark-matches', spreadsheetId: source.spreadsheet_id, range: sourceRange(source), matches: marks }) });
          if (!mark.ok) { const detail = await mark.json().catch(() => ({})); throw new Error(detail?.error || 'Не удалось отметить совпадения'); }
        }
      }
      return new Response(JSON.stringify({ valid: true, success: true, matched }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'save-sheets-settings') {
      const spreadsheetInput = String(body.spreadsheetId || '').trim();
      const spreadsheetMatch = spreadsheetInput.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      const spreadsheetId = (spreadsheetMatch?.[1] || spreadsheetInput).trim();
      const sheetName = String(body.sheetName || '').trim();
      const columnRange = String(body.sheetRange || 'A:Z').trim().toUpperCase();

      if (!/^[a-zA-Z0-9_-]{20,200}$/.test(spreadsheetId)) {
        return new Response(JSON.stringify({
          valid: true,
          success: false,
          error: 'Укажите корректную ссылку или ID Google Таблицы',
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (sheetName.length > 100 || !/^[A-Z]+(?::[A-Z]+|[0-9]+:[A-Z]+[0-9]+)?$/.test(columnRange)) {
        return new Response(JSON.stringify({
          valid: true,
          success: false,
          error: 'Проверьте название листа и диапазон, например A:Z',
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const escapedSheetName = sheetName.replace(/'/g, "''");
      const fullRange = sheetName ? `'${escapedSheetName}'!${columnRange}` : columnRange;
      const { error: settingsError } = await supabase
        .from('profiles')
        .upsert(
          { user_id: linkData.owner_user_id, spreadsheet_id: spreadsheetId, sheet_range: fullRange },
          { onConflict: 'user_id' },
        );

      if (settingsError) {
        console.error('Public Sheets settings update failed:', settingsError);
        return new Response(JSON.stringify({
          valid: true,
          success: false,
          error: `Не удалось сохранить настройки: ${settingsError.message}`,
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        valid: true,
        success: true,
        sheetsSettings: { spreadsheetId, sheetName, sheetRange: columnRange },
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'analytics') {
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(body.fromDate || '')
        ? body.fromDate
        : new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
      const { data: analytics, error: analyticsError } = await supabase.rpc(
        'public_analytics_summary',
        { target_user_id: linkData.owner_user_id, from_date: fromDate },
      );
      if (analyticsError) {
        return new Response(JSON.stringify({ valid: false, error: 'Failed to aggregate analytics' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ valid: true, analytics }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'sync-bank') {
      const { data: latestConnection } = await supabase
        .from('bank_connections')
        .select('last_sync_at')
        .eq('user_id', linkData.owner_user_id)
        .order('last_sync_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      const lastSyncAt = latestConnection?.last_sync_at
        ? new Date(latestConnection.last_sync_at).getTime()
        : 0;

      if (lastSyncAt && Date.now() - lastSyncAt < 30_000) {
        return new Response(
          JSON.stringify({ valid: true, success: true, action: body.action, imported: 0, throttled: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const syncResponse = await fetch(`${supabaseUrl}/functions/v1/banking-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: linkData.owner_user_id }),
      });
      const syncResult = await syncResponse.json().catch(() => ({ error: `HTTP ${syncResponse.status}` }));

      if (!syncResponse.ok) {
        console.error('Public bank sync failed:', syncResponse.status, syncResult);
        return new Response(
          JSON.stringify({
            valid: true,
            success: false,
            error: syncResult?.error || `Bank sync failed: HTTP ${syncResponse.status}`,
          }),
          { status: syncResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          valid: true,
          success: true,
          action: body.action,
          imported: Number(syncResult?.imported || 0),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (body.action === 'add-rule-terms') {
      const terms = parseTerms(body.terms);
      const requestedTypes = Array.isArray(body.transactionTypes)
        ? body.transactionTypes.filter((type) => type === 'income' || type === 'expense')
        : [];
      const transactionTypes = requestedTypes.length > 0 ? Array.from(new Set(requestedTypes)) : ['income', 'expense'];

      if (terms.length === 0) {
        return new Response(
          JSON.stringify({ valid: true, success: false, error: 'No terms to add' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: notification, error: notificationError } = await supabase
        .from('notifications')
        .insert({
          user_id: linkData.owner_user_id,
          title: 'Новые слова для поиска',
          message: `Пользователь публичной ссылки предложил: ${terms.join(', ')}`,
          type: 'rule_request',
          is_read: false,
          metadata: {
            request_type: 'department_rule_terms',
            terms,
            transaction_types: transactionTypes,
            departments: transactionTypes.map((type) => OTHER_DEPARTMENT_BY_TYPE[type]),
            source: 'public_transactions',
            token: linkData.token,
          },
        })
        .select('id')
        .single();

      if (notificationError) {
        console.error('Rule request notification insert failed:', notificationError);
        return new Response(
          JSON.stringify({ valid: true, success: false, error: `Failed to create notification: ${notificationError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (notification?.id) {
        const pushResult = await sendPushNotification(supabaseUrl, supabaseServiceKey, notification.id);
        if (!pushResult || Number(pushResult.sent || 0) < 1) {
          await supabase
            .from('notifications')
            .update({
              metadata: {
                request_type: 'department_rule_terms',
                terms,
                transaction_types: transactionTypes,
                departments: transactionTypes.map((type) => OTHER_DEPARTMENT_BY_TYPE[type]),
                source: 'public_transactions',
                token: linkData.token,
                push_last_result: pushResult,
                push_last_checked_at: new Date().toISOString(),
              },
            })
            .eq('id', notification.id);
        }
      }

      return new Response(
        JSON.stringify({ valid: true, success: true, action: body.action, addedTerms: terms }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: categories, error: categoriesError } = await supabase
      .from('categories')
      .select('id, name, type')
      .eq('user_id', linkData.owner_user_id)
      .order('sort_order', { ascending: true });

    if (categoriesError) {
      console.warn('Categories loading failed:', categoriesError.message);
    }

    const { data: departmentRules, error: rulesError } = await supabase
      .from('department_rules')
      .select('search_text, department_name, transaction_type')
      .eq('user_id', linkData.owner_user_id)
      .order('created_at', { ascending: false });

    if (rulesError) {
      console.warn('Department rules loading failed:', rulesError.message);
    }

    const { data: pendingRuleNotifications, error: pendingRulesError } = await supabase
      .from('notifications')
      .select('metadata')
      .eq('user_id', linkData.owner_user_id)
      .eq('type', 'rule_request')
      .order('created_at', { ascending: false });

    if (pendingRulesError) {
      console.warn('Pending rule notifications loading failed:', pendingRulesError.message);
    }

    let transactionsQuery = supabase
      .from('transactions')
      .select('*')
      .eq('user_id', linkData.owner_user_id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(501);

    const cursor = body.cursor;
    if (cursor
      && /^\d{4}-\d{2}-\d{2}$/.test(cursor.date)
      && cursor.createdAt
      && /^[0-9a-f-]{36}$/i.test(cursor.id)) {
      transactionsQuery = transactionsQuery.or(
        `date.lt.${cursor.date},and(date.eq.${cursor.date},created_at.lt.${cursor.createdAt}),and(date.eq.${cursor.date},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    }

    if (body.action === 'export-sheets') {
      try {
        const transactionIds = Array.isArray(body.transactionIds)
          ? Array.from(new Set(body.transactionIds.filter(id => /^[0-9a-f-]{36}$/i.test(id)))).slice(0, 1000)
          : [];
        if (transactionIds.length === 0) {
          return new Response(JSON.stringify({ valid: true, success: false, error: 'Нет корректных транзакций для экспорта' }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: exportRows, error: exportError } = await supabase
          .from('transactions')
          .select('type,amount,currency,description,bank_title,bank_sender,bank_recipient,comment')
          .eq('user_id', linkData.owner_user_id)
          .in('id', transactionIds)
          .order('date', { ascending: false });
        if (exportError) throw new Error(`Ошибка чтения транзакций: ${exportError.message}`);

        const values = [
          ['Отправитель', 'Получатель', 'Сумма и валюта', 'Тип', 'Описание', 'Назначение', 'Комментарий'],
          ...(exportRows || []).map(row => [
            row.bank_sender || '',
            row.bank_recipient || '',
            `${row.amount ?? ''}${row.currency ? ` ${row.currency}` : ''}`.trim(),
            row.type === 'income' ? 'Доход' : 'Расход',
            row.description || '',
            row.bank_title || '',
            row.comment || '',
          ]),
        ];
        const sheetsResponse = await fetch(`${supabaseUrl}/functions/v1/google-sheets`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
            'x-owner-user-id': linkData.owner_user_id,
          },
          body: JSON.stringify({ action: 'write', values, transactionTypeColors: true }),
        });
        const responseText = await sheetsResponse.text();
        let sheetsResult: Record<string, any> = {};
        try { sheetsResult = responseText ? JSON.parse(responseText) : {}; } catch { sheetsResult = { error: responseText }; }
        if (!sheetsResponse.ok || !sheetsResult?.success) {
          const detail = sheetsResult?.error || sheetsResult?.message || `Google Sheets HTTP ${sheetsResponse.status}`;
          console.error('Public Google Sheets export failed:', sheetsResponse.status, detail);
          return new Response(JSON.stringify({ valid: true, success: false, error: detail }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          valid: true, success: true, exported: Math.max(0, values.length - 1),
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (exportFailure) {
        const message = exportFailure instanceof Error ? exportFailure.message : String(exportFailure);
        console.error('Public export failed:', message);
        return new Response(JSON.stringify({ valid: true, success: false, error: message }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const [{ data: transactions, error: transactionsError }, { data: sheetsProfile }, { data: registrationSources }] = await Promise.all([
      transactionsQuery,
      supabase
        .from('profiles')
        .select('spreadsheet_id, sheet_range')
        .eq('user_id', linkData.owner_user_id)
        .maybeSingle(),
      supabase
        .from('registration_sheet_sources')
        .select('id, spreadsheet_id, sheet_name, sheet_range, name_columns')
        .eq('owner_user_id', linkData.owner_user_id)
        .order('created_at'),
    ]);

    if (transactionsError) {
      console.error('Transactions loading failed:', transactionsError);
      return new Response(
        JSON.stringify({ valid: false, error: 'Failed to load transactions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: analyticsNotifications } = body.includeNotifications
      ? await supabase
        .from('notifications')
        .select('type, created_at, metadata')
        .eq('user_id', linkData.owner_user_id)
        .neq('type', 'push_subscription')
        .neq('type', 'rule_request')
        .order('created_at', { ascending: false })
      : { data: [] };

    const page = (transactions || []).slice(0, 500);
    const lastTransaction = page[page.length - 1];

    const configuredRange = String(sheetsProfile?.sheet_range || 'A:Z');
    const configuredRangeMatch = configuredRange.match(/^'((?:[^']|'')+)'!(.+)$/);

    return new Response(
      JSON.stringify({
        valid: true,
        categories: categories || [],
        otherRuleSearchTerms: getOtherRuleSearchTerms(departmentRules || []),
        pendingRuleSearchTerms: getPendingRuleSearchTerms(pendingRuleNotifications || []),
        transactions: page.map((tx) => mapTransaction(tx, departmentRules || [])),
        hasMore: (transactions || []).length > 500,
        nextCursor: lastTransaction ? {
          date: lastTransaction.date,
          createdAt: lastTransaction.created_at,
          id: lastTransaction.id,
        } : null,
        sheetsSettings: {
          spreadsheetId: sheetsProfile?.spreadsheet_id || '',
          sheetName: configuredRangeMatch ? configuredRangeMatch[1].replace(/''/g, "'") : '',
          sheetRange: configuredRangeMatch ? configuredRangeMatch[2] : configuredRange,
        },
        registrationSources: registrationSources || [],
        notifications: (analyticsNotifications || []).map((notification: any) => ({
          type: notification.type,
          createdAt: notification.created_at,
          documentType: notification.metadata?.document_type,
        })),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ valid: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
