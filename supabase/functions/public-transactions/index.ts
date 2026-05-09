import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface PublicTransactionsRequest {
  token: string;
  action?: 'add-rule-terms';
  terms?: string[];
  transactionTypes?: Array<'income' | 'expense'>;
}

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

const mergeTerms = (existingText: string, newTerms: string[]) => {
  const existingTerms = existingText
    .split(',')
    .map(normalizeTerm)
    .filter(Boolean);

  const seen = new Set(existingTerms.map((term) => term.toLowerCase()));
  const merged = [...existingTerms];

  for (const term of newTerms) {
    const key = term.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(term);
    }
  }

  return merged.join(', ');
};

const getOtherRuleCandidates = (rules: Array<{ id: string; search_text: string; department_name?: string | null }>) =>
  rules.filter((rule) => String(rule.department_name || '').toLowerCase().includes('прочее'));

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

const mapTransaction = (tx: any, rules: any[] = []) => ({
  id: tx.id,
  type: tx.type,
  category: tx.category_id || 'other',
  amount: Number(tx.amount),
  currency: tx.currency,
  description: tx.description || '',
  date: tx.date,
  createdAt: tx.created_at,
  issuedTo: tx.issued_to || undefined,
  decisionNumber: tx.decision_number || undefined,
  amountInWords: tx.amount_in_words || undefined,
  cashierName: tx.cashier_name || undefined,
  bankTitle: tx.bank_title || undefined,
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

      for (const transactionType of transactionTypes) {
        const departmentName = OTHER_DEPARTMENT_BY_TYPE[transactionType];

        const { data: existingRules, error: existingError } = await supabase
          .from('department_rules')
          .select('id, search_text, department_name')
          .eq('user_id', linkData.owner_user_id)
          .eq('transaction_type', transactionType)
          .order('created_at', { ascending: true });

        if (existingError) {
          console.error('Department rule lookup failed:', existingError);
          return new Response(
            JSON.stringify({ valid: true, success: false, error: `Failed to load rules: ${existingError.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }

        const otherRules = getOtherRuleCandidates(existingRules || []);
        const primaryRule =
          otherRules.find((rule) => rule.department_name === departmentName) ||
          otherRules[0];

        if (!primaryRule) {
          return new Response(
            JSON.stringify({
              valid: true,
              success: false,
              error: `Нет существующего правила для ${departmentName}. Создайте его один раз в настройках "Расширение", потом публичная ссылка будет только дописывать слова.`,
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }

        const duplicateRules = otherRules.filter((rule) => rule.id !== primaryRule.id);
        const duplicateTerms = duplicateRules.flatMap((rule) =>
          String(rule.search_text || '')
            .split(',')
            .map(normalizeTerm)
            .filter(Boolean)
        );
        const mergedSearchText = mergeTerms(primaryRule.search_text || '', [...duplicateTerms, ...terms]);

        const { error: updateError } = await supabase
          .from('department_rules')
          .update({
            search_text: mergedSearchText,
            department_name: departmentName,
            transaction_type: transactionType,
          })
          .eq('id', primaryRule.id)
          .eq('user_id', linkData.owner_user_id);

        if (updateError) {
          console.error('Department rule update failed:', updateError);
          return new Response(
            JSON.stringify({ valid: true, success: false, error: `Failed to update rule: ${updateError.message}` }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }

        if (duplicateRules.length > 0) {
          const { error: deleteError } = await supabase
            .from('department_rules')
            .delete()
            .eq('user_id', linkData.owner_user_id)
            .in('id', duplicateRules.map((rule) => rule.id));

          if (deleteError) {
            console.error('Department rule duplicate cleanup failed:', deleteError);
            return new Response(
              JSON.stringify({ valid: true, success: false, error: `Failed to clean duplicate rules: ${deleteError.message}` }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
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

    const { data: transactions, error: transactionsError } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', linkData.owner_user_id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (transactionsError) {
      console.error('Transactions loading failed:', transactionsError);
      return new Response(
        JSON.stringify({ valid: false, error: 'Failed to load transactions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        valid: true,
        categories: categories || [],
        transactions: (transactions || []).map((tx) => mapTransaction(tx, departmentRules || [])),
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
