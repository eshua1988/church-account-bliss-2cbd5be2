import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface PublicTransactionsRequest {
  token: string;
  includeNotifications?: boolean;
  action?: 'add-rule-terms' | 'sync-bank' | 'export-sheets' | 'save-sheets-settings' | 'save-export-source' | 'delete-export-source' | 'save-registration-source' | 'delete-registration-source' | 'reconcile-registration-sheets' | 'list-sheets';
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
  targetId?: string;
  nameColumns?: string;
  amountColumn?: string;
  keywords?: string[];
}

type RegistrationSource = { id: string; spreadsheet_id: string; sheet_name: string; sheet_range: string; name_columns: string; amount_column: string };
type ExportSource = { id: string; spreadsheet_id: string; sheet_name: string; sheet_range: string };

const transliteration: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', ё: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
};
// Google Forms data can be Cyrillic while the bank uses a Latin spelling.
// Keep these as Unicode escapes so the Edge Function source is not affected by
// an editor or deployment changing its text encoding.
const cyrillicTransliteration: Record<string, string> = {
  '\u0430': 'a', '\u0431': 'b', '\u0432': 'v', '\u0433': 'h', '\u0491': 'g', '\u0434': 'd', '\u0435': 'e', '\u0451': 'e', '\u0454': 'ie', '\u0436': 'zh', '\u0437': 'z', '\u0438': 'y', '\u0456': 'i', '\u0457': 'i', '\u0439': 'i', '\u043a': 'k', '\u043b': 'l', '\u043c': 'm', '\u043d': 'n', '\u043e': 'o', '\u043f': 'p', '\u0440': 'r', '\u0441': 's', '\u0442': 't', '\u0443': 'u', '\u0444': 'f', '\u0445': 'kh', '\u0446': 'ts', '\u0447': 'ch', '\u0448': 'sh', '\u0449': 'shch', '\u044a': '', '\u044b': 'y', '\u044c': '', '\u044d': 'e', '\u044e': 'iu', '\u044f': 'ia',
};
const normalizePerson = (value: unknown) => String(value || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .split('').map(char => cyrillicTransliteration[char] ?? transliteration[char] ?? char).join('')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
// Makes transliterated variants such as Maria / Mariia comparable without
// weakening surname matching to a generic substring search.
const comparablePersonToken = (value: string) => value
  .replace(/([aeiouy])\1+/g, '$1')
  .replace(/ie/g, 'i')
  .replace(/ia/g, 'a')
  .replace(/ya/g, 'a');
// A few registrations use familiar forms (for example, "Zhenia") while the
// bank has the person's full passport spelling ("Yevheniia").  These aliases
// are deliberately narrow: the other name token still has to identify the
// same surname, so an alias can never match a person on its own.
const personTokenVariants = (value: string) => {
  const token = comparablePersonToken(value);
  const variants = new Set([token]);
  const aliases: Record<string, string[]> = {
    andrei: ['andrii'],
    daria: ['dariia'],
    ilia: ['illia'],
    iosif: ['joseph', 'josef', 'yosef'],
    maria: ['mariia'],
    pavel: ['pavlo'],
    snezhana: ['sniazhana'],
    vasyliu: ['vasileiou'],
    zhenia: ['yevheniia', 'evheniia', 'yevgeniia', 'evgeniia'],
  };

  // The form uses Ukrainian/Russian spellings while payment text is often
  // entered with a Polish or international transliteration. These are
  // letter-for-letter alternatives (not loose fuzzy matching), so the second
  // token of a name is still required before a transaction is credited.
  for (const transform of [
    (candidate: string) => candidate.replace(/h/g, 'g'),
    (candidate: string) => candidate.replace(/g/g, 'h'),
    (candidate: string) => candidate.replace(/y/g, 'i'),
    (candidate: string) => candidate.replace(/i/g, 'y'),
  ]) {
    for (const candidate of [...variants]) {
      variants.add(comparablePersonToken(transform(candidate)));
    }
  }
  for (const candidate of [...variants]) {
    for (const alias of aliases[candidate] || []) variants.add(comparablePersonToken(alias));
  }
  return [...variants];
};
const levenshteinDistance = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[right.length];
};
// Returns 2 for an exact transliterated token and 1 only for a small typo.
// Reconciliation requires at least one exact token, preventing a person from
// being matched just because two different names happen to be similarly spelt.
const personTokenMatchScore = (expected: string, actual: string) => {
  const expectedVariants = personTokenVariants(expected);
  const actualVariants = personTokenVariants(actual);
  let bestScore = 0;

  for (const left of expectedVariants) {
    for (const right of actualVariants) {
      if (left.length < 3 || right.length < 3) continue;
      if (left === right) return 2;
      // A partial token may occur when punctuation was omitted (for example
      // RETREAT.VOLODYMYR). It remains a weak match and needs an exact partner.
      if (left.includes(right) || right.includes(left)) {
        bestScore = Math.max(bestScore, 1);
        continue;
      }
      const allowedErrors = Math.max(left.length, right.length) >= 9 ? 2 : 1;
      if (Math.abs(left.length - right.length) <= allowedErrors
        && levenshteinDistance(left, right) <= allowedErrors) {
        bestScore = Math.max(bestScore, 1);
      }
    }
  }
  return bestScore;
};
const lettersToIndex = (column: string) => column.split('').reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
const sourceRange = (source: Pick<RegistrationSource, 'sheet_name' | 'sheet_range'>) => {
  const name = source.sheet_name.replace(/'/g, "''");
  return source.sheet_name ? `'${name}'!${source.sheet_range}` : source.sheet_range;
};
// Column ranges accept C, c, C:C and c:c and are stored as C:C.
// Other characters and row numbers are not valid for these settings.
const normalizeColumnRange = (value: string) => {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]+(?::[A-Z]+)?$/.test(normalized)) return '';
  const [start, end] = normalized.split(':');
  return `${start}:${end || start}`;
};
const parseSheetAmount = (value: unknown) => {
  const normalized = String(value ?? '')
    .replace(/\s/g, '')
    .replace(/[^0-9,.-]/g, '')
    .replace(',', '.');
  const amount = Number(normalized);
  return normalized && Number.isFinite(amount) ? amount : null;
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

// Banks distribute the payment purpose between different fields.  Do not use
// only the first non-empty one: a generic bank title such as "RETREAT." can
// otherwise hide the participant name stored in the description.  Sender and
// recipient are intentionally excluded: they can belong to a refund or a
// transfer counterparty rather than to the registered participant.
const transactionPaymentText = (transaction: { bank_title?: string | null; title?: string | null; description?: string | null; comment?: string | null }) =>
  normalizePerson([
    transaction.bank_title,
    transaction.title,
    transaction.description,
    transaction.comment,
  ].filter(Boolean).join(' '));

const transactionTitleOrDescriptionText = (transaction: { bank_title?: string | null; title?: string | null; description?: string | null }) =>
  normalizePerson([
    transaction.bank_title,
    transaction.title,
    transaction.description,
  ].filter(Boolean).join(' '));

const transactionSenderText = (transaction: { bank_sender?: string | null }) =>
  normalizePerson(transaction.bank_sender);

// Exports must identify the participant from the payment itself. Bank sender
// details are intentionally excluded here: the account holder can be a parent,
// employer or another payer rather than the participant named in the payment.
const exportNameFromPaymentText = (transaction: { bank_title?: string | null; description?: string | null }) => {
  const paymentTitle = cleanBankText(transaction.bank_title);
  const description = cleanBankText(transaction.description);
  return [paymentTitle, description]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .join(' · ');
};

// Export rows are transaction rows, not registration rows. Keep only the
// person part of the payment text; generic bank wording must not stop the
// Nadawca fallback from being used. A family title may therefore keep one
// surname followed by every associated given name.
const exportNonNameWords = new Set([
  'retreat', 'payment', 'transfer', 'freedom', 'zwrot', 'refund', 'return',
  'przelew', 'oplata', 'wplata', 'perevod', 'oplaty', 'vozvrat', 'dohod',
  'rashod', 'drugoe', 'other', 'income', 'expense', 'blik', 'mobile', 'c2c',
  'za', 'na', 'do', 'od', 'i', 'and',
]);

const paymentNamePart = (value: unknown) => {
  const cleaned = cleanBankText(value);
  const words = cleaned.match(/[A-Za-z\u00c0-\u024f\u0400-\u04ff]+/g) || [];
  const personWords = words.filter(word => !exportNonNameWords.has(normalizePerson(word)));
  // A single word is not enough: the requested fallback is used whenever the
  // title/description does not demonstrate both a first and last name.
  if (personWords.length < 2) return '';
  return cleaned
    .replace(/\b(?:777|retreat|payment|transfer|freedom|zwrot|zwrót|refund|return|przelew|opłata|oplata|wpłata|wplata|perevod|перевод|оплата|возврат|доход|расход|прочее|other|income|expense|blik|mobile|c2c|za|na|do|od|and|i)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:·—–-]+|[\s,;:·—–-]+$/g, '')
    .trim();
};

const exportParticipantName = (transaction: { bank_title?: string | null; description?: string | null; bank_sender?: string | null }) => {
  const paymentNames = [paymentNamePart(transaction.bank_title), paymentNamePart(transaction.description)]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .join(' · ');
  return paymentNames || cleanBankText(transaction.bank_sender);
};

// A registration cell may contain a family in several common forms:
// "Sheremet Oksana, Joseph", "Iosif Sheremet, Sheremet Oksana", or a
// mixture of both. Consider every two different name words as a possible
// surname/given-name pair. The transaction still needs two separate matching
// words, so this is more flexible without allowing surname-only matches.
const registrationNamePairs = (nameTokens: string[]): Array<[string, string]> => {
  const tokens = [...new Set(nameTokens.filter(token => token.length >= 3))];
  const pairs: Array<[string, string]> = [];
  for (let left = 0; left < tokens.length; left += 1) {
    for (let right = left + 1; right < tokens.length; right += 1) {
      pairs.push([tokens[left], tokens[right]]);
    }
  }
  return pairs;
};

const paymentDisplayWords = (transaction: { bank_title?: string | null; description?: string | null }) =>
  [transaction.bank_title, transaction.description]
    .filter(Boolean)
    .join(' ')
    .match(/[A-Za-z\u00c0-\u024f\u0400-\u04ff]+/g) || [];

// For a family payment the bank usually lists one surname and several given
// names. Column C must show that bank spelling, not a sender name and not a
// transliteration from the registration form.
const familyPaymentExplanation = (
  transaction: { bank_title?: string | null; description?: string | null },
  registrations: Array<{ tokens: string[] }>,
) => {
  if (registrations.length < 2) return '';
  const words = paymentDisplayWords(transaction)
    .map(display => ({ display, normalized: normalizePerson(display) }))
    .filter(word => word.normalized.length >= 3)
    .filter(word => registrations.some(registration => registration.tokens.some(token =>
      personTokenMatchScore(token, word.normalized) > 0,
    )));
  const distinctWords = words.filter((word, index) =>
    words.findIndex(candidate => candidate.normalized === word.normalized) === index,
  );
  if (distinctWords.length < 3) return '';

  const surname = distinctWords
    .map(word => ({
      ...word,
      registrations: registrations.filter(registration => registration.tokens.some(token =>
        personTokenMatchScore(token, word.normalized) > 0,
      )).length,
    }))
    .sort((left, right) => right.registrations - left.registrations)[0];
  if (!surname || surname.registrations < 2) return '';

  const givenNames = distinctWords.filter(word => word.normalized !== surname.normalized);
  return givenNames.length >= 2
    ? givenNames.map(word => `${surname.display} ${word.display}`).join(', ')
    : '';
};

// Match a registration only when its surname and first name are demonstrated
// by two distinct transaction words. Sender matching keeps the first name
// exact, but permits a one-step surname variation (for example the family
// forms Kharybin / Kharybina / Kharybiny). This lets one payment with a shared
// surname and several given names credit every registered family member while
// still preventing a match based on a surname alone.
const registrationMatchesTransactionText = (nameTokens: string[], text: string, senderFallback = false) => {
  const transactionTokens = text.split(' ').filter(token => token.length >= 3);
  const candidatePairs = registrationNamePairs(nameTokens);

  return candidatePairs.some(([first, second]) => transactionTokens.some((firstCandidate, firstIndex) => {
    const firstScore = personTokenMatchScore(first, firstCandidate);
    if (!firstScore) return false;
    return transactionTokens.some((secondCandidate, secondIndex) => {
      if (secondIndex === firstIndex) return false;
      const secondScore = personTokenMatchScore(second, secondCandidate);
      if (!secondScore) return false;
      return senderFallback
        ? (firstScore === 2 && secondScore >= 1) || (secondScore === 2 && firstScore >= 1)
        : firstScore + secondScore >= 3;
    });
  }));
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

const transactionNoteText = (transaction: { bank_title?: string | null; title?: string | null; description?: string | null }) => {
  const title = cleanBankText(transaction.bank_title || transaction.title);
  const description = cleanBankText(transaction.description);
  return [
    title && `Назначение: ${title}`,
    description && description !== title && `Описание: ${description}`,
  ].filter(Boolean).join(' · ');
};

const mapTransaction = (tx: any, rules: any[] = []) => ({
  id: tx.id,
  type: tx.type,
  category: tx.category_id || 'other',
  amount: Number(tx.amount),
  currency: tx.currency,
  // Keep the original description separate from the bank payment title.  The
  // previous fallback order made both fields display the participant's name.
  description: cleanBankText(tx.description) || cleanBankText(tx.bank_title),
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

    if (body.action === 'list-sheets') {
      const input = String(body.spreadsheetId || '').trim();
      const spreadsheetId = (input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || input).trim();
      if (!/^[a-zA-Z0-9_-]{20,200}$/.test(spreadsheetId)) {
        return new Response(JSON.stringify({ valid: true, success: false, error: 'Укажите корректную ссылку или ID Google Таблицы.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const response = await fetch(`${supabaseUrl}/functions/v1/google-sheets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json', 'x-owner-user-id': linkData.owner_user_id },
        body: JSON.stringify({ action: 'list-sheets', spreadsheetId, range: 'A:Z' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) throw new Error(result?.error || 'Не удалось получить список листов Google Таблицы.');
      return new Response(JSON.stringify({ valid: true, success: true, sheets: result.sheets || [] }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'save-registration-source') {
      const input = String(body.spreadsheetId || '').trim();
      const spreadsheetId = (input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || input).trim();
      const sheetName = String(body.sheetName || '').trim();
      const sheetRange = normalizeColumnRange(String(body.sheetRange || 'A:Z'));
      const nameColumns = normalizeColumnRange(String(body.nameColumns || 'A:B'));
      if (!/^[a-zA-Z0-9_-]{20,200}$/.test(spreadsheetId) || !sheetRange || !nameColumns) {
        return new Response(JSON.stringify({ valid: true, success: false, error: 'Проверьте ссылку, диапазон листа и колонки с именем.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const record = { owner_user_id: linkData.owner_user_id, spreadsheet_id: spreadsheetId, sheet_name: sheetName, sheet_range: sheetRange, name_columns: nameColumns, amount_column: '' };
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

    if (body.action === 'save-export-source') {
      const input = String(body.spreadsheetId || '').trim();
      const spreadsheetId = (input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || input).trim();
      const sheetName = String(body.sheetName || '').trim();
      const sheetRange = normalizeColumnRange(String(body.sheetRange || 'A:Z'));
      if (!/^[a-zA-Z0-9_-]{20,200}$/.test(spreadsheetId) || !sheetRange) {
        return new Response(JSON.stringify({ valid: true, success: false, error: 'Проверьте ссылку, лист и диапазон.' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const record = { owner_user_id: linkData.owner_user_id, spreadsheet_id: spreadsheetId, sheet_name: sheetName, sheet_range: sheetRange };
      const query = body.sourceId && /^[0-9a-f-]{36}$/i.test(body.sourceId)
        ? supabase.from('public_export_sheet_targets').update(record).eq('id', body.sourceId).eq('owner_user_id', linkData.owner_user_id).select().single()
        : supabase.from('public_export_sheet_targets').upsert(record, { onConflict: 'owner_user_id,spreadsheet_id,sheet_name,sheet_range' }).select().single();
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ valid: true, success: true, source: data }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'delete-export-source') {
      if (!body.sourceId || !/^[0-9a-f-]{36}$/i.test(body.sourceId)) throw new Error('Invalid source ID');
      const { error } = await supabase.from('public_export_sheet_targets').delete().eq('id', body.sourceId).eq('owner_user_id', linkData.owner_user_id);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ valid: true, success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'delete-registration-source') {
      if (!body.sourceId || !/^[0-9a-f-]{36}$/i.test(body.sourceId)) throw new Error('Invalid source ID');
      const { error } = await supabase.from('registration_sheet_sources').delete().eq('id', body.sourceId).eq('owner_user_id', linkData.owner_user_id);
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ valid: true, success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'reconcile-registration-sheets') {
      const [{ data: sources, error: sourceError }, { data: transactions, error: transactionError }, { data: keywordRules, error: keywordRulesError }] = await Promise.all([
        supabase.from('registration_sheet_sources').select('id, spreadsheet_id, sheet_name, sheet_range, name_columns, amount_column').eq('owner_user_id', linkData.owner_user_id),
        // A person's name may be written in the payment title of either an
        // incoming or an outgoing bank transaction, so compare both types.
        supabase.from('transactions').select('id, type, date, amount, currency, bank_sender, bank_recipient, bank_title, description, comment').eq('user_id', linkData.owner_user_id).order('date', { ascending: false }).limit(3000),
        supabase.from('department_rules').select('search_text, department_name, transaction_type').eq('user_id', linkData.owner_user_id),
      ]);
      if (sourceError || transactionError || keywordRulesError) throw new Error(sourceError?.message || transactionError?.message || keywordRulesError?.message);
      const approvedKeywords = new Set([
        ...getOtherRuleSearchTerms(keywordRules || []).income,
        ...getOtherRuleSearchTerms(keywordRules || []).expense,
      ].map(term => normalizePerson(term)).filter(Boolean));
      const requestedKeywords = parseTerms(body.keywords).map(term => normalizePerson(term)).filter(term => approvedKeywords.has(term));
      if (requestedKeywords.length === 0) {
        return new Response(
          JSON.stringify({ valid: true, success: false, error: 'Введите подтверждённое ключевое слово в строку поиска перед сверкой.' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const transactionsForReconciliation = requestedKeywords.length > 0
        ? (transactions || []).filter(transaction => {
            const text = transactionPaymentText(transaction);
            return requestedKeywords.some(keyword => text.includes(keyword));
          })
        : transactions || [];
      let matched = 0;
      let matchedByPaymentText = 0;
      let matchedBySender = 0;
      for (const source of (sources || []) as RegistrationSource[]) {
        const read = await fetch(`${supabaseUrl}/functions/v1/google-sheets`, { method: 'POST', headers: { Authorization: `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json', 'x-owner-user-id': linkData.owner_user_id }, body: JSON.stringify({ action: 'read', spreadsheetId: source.spreadsheet_id, range: sourceRange(source) }) });
        const result = await read.json().catch(() => ({}));
        if (!read.ok) throw new Error(result?.error || `Не удалось прочитать лист ${source.sheet_name}`);
        const values: string[][] = result.values || [];
        // Values returned by Google start at the first column of sheet_range.
        // For example, for C:C the name is values[row][0], not values[row][2].
        const rangeStartColumn = source.sheet_range.match(/^([A-Z]+)/)?.[1] || 'A';
        const rangeStartIndex = lettersToIndex(rangeStartColumn);
        // A single-column range is stored as C:C.  Treat it as one column,
        // not two identical C entries, otherwise a surname can be compared
        // against itself and create a false positive.
        const configuredColumns = Array.from(new Set(
          source.name_columns.split(':').map(column => lettersToIndex(column) - rangeStartIndex),
        ));
        const header = values[0] || [];
        // Forms often keep full name in one column named "Фамилия, Имя".
        // Prefer it over an old broad A:Z setting, so only surname and name
        // take part in matching rather than team, phone or form answers.
        const surnameHeaderIndex = header.findIndex(value => /фамил|прізв|surname|last.?name/i.test(String(value || '')));
        const nameHeaderIndex = header.findIndex(value => /имя|ім.?я|first.?name|name/i.test(String(value || '')));
        const columns = (source.name_columns === 'A:Z' && (surnameHeaderIndex >= 0 || nameHeaderIndex >= 0))
          ? [surnameHeaderIndex >= 0 ? surnameHeaderIndex : nameHeaderIndex]
          : configuredColumns;
        const sourceNames = values.slice(1)
          .map(row => columns.map(column => String(row[column] || '')).join(' ').trim())
          .filter(Boolean);
        const registrationNames = sourceNames
          .map(name => normalizePerson(name).split(' ').filter(token => token.length >= 3))
          .filter(tokens => tokens.length >= 2);
        // A registration column must contain at least a first name and a
        // surname. Silently accepting a date or first-name-only column creates
        // a misleading empty reconciliation report.
        if (sourceNames.length > 0 && registrationNames.length * 2 < sourceNames.length) {
          throw new Error(`\u0412 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0435 ${source.sheet_name || '\u0442\u0430\u0431\u043b\u0438\u0446\u0430'}:${source.name_columns} \u0431\u043e\u043b\u044c\u0448\u0438\u043d\u0441\u0442\u0432\u043e \u0441\u0442\u0440\u043e\u043a \u043d\u0435 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u0438\u043c\u0435\u043d\u0438 \u0438 \u0444\u0430\u043c\u0438\u043b\u0438\u0438. \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u043e\u043b\u043e\u043d\u043a\u0443 \u0441 \u0418\u043c\u0435\u043d\u0435\u043c \u0438 \u0444\u0430\u043c\u0438\u043b\u0438\u0435\u0439 \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0430.`);
        }
        // Do not use Nadawca if the payment title/description already names
        // another registered person. Sender fallback is exclusively for bank
        // records whose payment text contains no participant name at all.
        const transactionsWithPaymentName = new Set(
          transactionsForReconciliation
            .filter(transaction => registrationNames.some(tokens =>
              registrationMatchesTransactionText(tokens, transactionPaymentText(transaction)),
            ))
            .map(transaction => transaction.id),
        );
        const marks = values.slice(1).flatMap((row, index) => {
          const person = normalizePerson(columns.map(column => row[column] || '').join(' '));
          const nameTokens = person.split(' ').filter(token => token.length >= 3);
          if (nameTokens.length < 2) return [];
          // Primary source: title, description and comment. This is the
          // existing reliable path and remains the preferred match.
          const paymentTx = transactionsForReconciliation.find(transaction =>
            registrationMatchesTransactionText(nameTokens, transactionPaymentText(transaction)),
          );
          // Fallback requested by the user: use Nadawca only when the person
          // is absent from title/description. Limit it to incoming payments,
          // where Nadawca is the payer, and require two exact name tokens.
          const senderTx = paymentTx ? undefined : transactionsForReconciliation.find(transaction =>
            transaction.type === 'income'
            && !transactionsWithPaymentName.has(transaction.id)
            && registrationMatchesTransactionText(nameTokens, transactionSenderText(transaction), true),
          );
          const tx = paymentTx || senderTx;
          if (!tx) return [];
          matched += 1;
          if (paymentTx) matchedByPaymentText += 1;
          else matchedBySender += 1;
          // Google batchUpdate uses absolute column indexes. `columns[0]` is
          // relative to the read range, so add its range offset back here.
          const senderNote = senderTx ? ` · Nadawca: ${tx.bank_sender || ''}` : '';
          return [{ row: index + 2, nameColumn: columns[0] + rangeStartIndex, note: `Найдена транзакция: ${tx.date} — ${tx.amount} ${tx.currency || ''}. ${transactionNoteText(tx)}${senderNote}`.trim() }];
        });
        const mark = await fetch(`${supabaseUrl}/functions/v1/google-sheets`, { method: 'POST', headers: { Authorization: `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json', 'x-owner-user-id': linkData.owner_user_id }, body: JSON.stringify({ action: 'mark-matches', spreadsheetId: source.spreadsheet_id, range: sourceRange(source), matches: marks, clearMatchNotes: { startRowIndex: 1, endRowIndex: values.length, columnIndex: columns[0] + rangeStartIndex } }) });
        if (!mark.ok) { const detail = await mark.json().catch(() => ({})); throw new Error(detail?.error || 'Не удалось отметить совпадения'); }
      }
      return new Response(JSON.stringify({ valid: true, success: true, matched, matchedByPaymentText, matchedBySender }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.action === 'save-sheets-settings') {
      const spreadsheetInput = String(body.spreadsheetId || '').trim();
      const spreadsheetMatch = spreadsheetInput.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      const spreadsheetId = (spreadsheetMatch?.[1] || spreadsheetInput).trim();
      const sheetName = String(body.sheetName || '').trim();
      const columnRange = normalizeColumnRange(String(body.sheetRange || 'A:Z'));

      if (!/^[a-zA-Z0-9_-]{20,200}$/.test(spreadsheetId)) {
        return new Response(JSON.stringify({
          valid: true,
          success: false,
          error: 'Укажите корректную ссылку или ID Google Таблицы',
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (sheetName.length > 100 || !columnRange) {
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

      // A term that is already present in an approved rule must not create a
      // second confirmation request. It can be used immediately by the public
      // page for search, export and reconciliation.
      const { data: existingRules, error: existingRulesError } = await supabase
        .from('department_rules')
        .select('search_text, department_name, transaction_type')
        .eq('user_id', linkData.owner_user_id);
      if (existingRulesError) throw new Error(existingRulesError.message);
      const existingTerms = new Set([
        ...getOtherRuleSearchTerms(existingRules || []).income,
        ...getOtherRuleSearchTerms(existingRules || []).expense,
      ].map(term => term.toLowerCase()));
      const alreadyApprovedTerms = terms.filter(term => existingTerms.has(term.toLowerCase()));
      const termsForConfirmation = terms.filter(term => !existingTerms.has(term.toLowerCase()));

      if (termsForConfirmation.length === 0) {
        return new Response(
          JSON.stringify({ valid: true, success: true, action: body.action, addedTerms: [], existingTerms: alreadyApprovedTerms }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const { data: notification, error: notificationError } = await supabase
        .from('notifications')
        .insert({
          user_id: linkData.owner_user_id,
          title: 'Новые слова для поиска',
          message: `Пользователь публичной ссылки предложил: ${termsForConfirmation.join(', ')}`,
          type: 'rule_request',
          is_read: false,
          metadata: {
            request_type: 'department_rule_terms',
            terms: termsForConfirmation,
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
                terms: termsForConfirmation,
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
        JSON.stringify({ valid: true, success: true, action: body.action, addedTerms: termsForConfirmation, existingTerms: alreadyApprovedTerms }),
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

        const { data: exportTarget, error: exportTargetError } = body.targetId && /^[0-9a-f-]{36}$/i.test(body.targetId)
          ? await supabase.from('public_export_sheet_targets').select('spreadsheet_id, sheet_name, sheet_range').eq('id', body.targetId).eq('owner_user_id', linkData.owner_user_id).maybeSingle()
          : { data: null, error: null };
        if (exportTargetError) throw new Error(exportTargetError.message);
        if (!exportTarget) throw new Error('Выберите добавленную таблицу для экспорта.');
        const { data: exportRows, error: exportError } = await supabase
          .from('transactions')
          .select('id,type,amount,currency,description,bank_title,bank_sender,bank_recipient,comment')
          .eq('user_id', linkData.owner_user_id)
          .in('id', transactionIds)
          .order('date', { ascending: false });
        if (exportError) throw new Error(`Ошибка чтения транзакций: ${exportError.message}`);

        const values = [
          ['Отправитель', 'Получатель', 'Сумма и валюта', 'Тип', 'Описание', 'Назначение', 'Комментарий'],
          ...(exportRows || []).map(row => [
            exportParticipantName(row),
            row.bank_recipient || '',
            `${row.amount ?? ''}${row.currency ? ` ${row.currency}` : ''}`.trim(),
            row.type === 'income' ? 'Доход' : 'Расход',
            row.description || '',
            row.bank_title || '',
            row.comment || '',
          ]),
        ];
        values[0][0] = '\u0418\u043c\u044f \u0438 \u0444\u0430\u043c\u0438\u043b\u0438\u044f (\u0442\u0438\u0442\u0443\u043b / \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0435; Nadawca \u0435\u0441\u043b\u0438 \u043d\u0435\u0442 \u0424\u0418\u041e)';
        // The export contains exactly the transactions selected on the public
        // page. Registration sheets are intentionally not read here.
        const transactionSheetsResponse = await fetch(`${supabaseUrl}/functions/v1/google-sheets`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
            'x-owner-user-id': linkData.owner_user_id,
          },
          body: JSON.stringify({ action: 'write', spreadsheetId: exportTarget.spreadsheet_id, range: sourceRange(exportTarget as ExportSource), values }),
        });
        const transactionResponseText = await transactionSheetsResponse.text();
        let transactionSheetsResult: Record<string, any> = {};
        try { transactionSheetsResult = transactionResponseText ? JSON.parse(transactionResponseText) : {}; } catch { transactionSheetsResult = { error: transactionResponseText }; }
        if (!transactionSheetsResponse.ok || !transactionSheetsResult?.success) {
          const detail = transactionSheetsResult?.error || transactionSheetsResult?.message || `Google Sheets HTTP ${transactionSheetsResponse.status}`;
          return new Response(JSON.stringify({ valid: true, success: false, error: detail }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          valid: true, success: true, exported: Math.max(0, values.length - 1),
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

        const { data: reportSources, error: reportSourcesError } = await supabase
          .from('registration_sheet_sources')
          .select('spreadsheet_id, sheet_name, sheet_range, name_columns')
          .eq('owner_user_id', linkData.owner_user_id);
        if (reportSourcesError) throw new Error(reportSourcesError.message);
        if (!reportSources?.length) throw new Error('Настройте таблицу регистрации перед экспортом сверки.');

        const registrations: Array<{ name: string; tokens: string[] }> = [];
        for (const source of reportSources as Array<Pick<RegistrationSource, 'spreadsheet_id' | 'sheet_name' | 'sheet_range' | 'name_columns'>>) {
          const readResponse = await fetch(`${supabaseUrl}/functions/v1/google-sheets`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
              'x-owner-user-id': linkData.owner_user_id,
            },
            body: JSON.stringify({ action: 'read', spreadsheetId: source.spreadsheet_id, range: sourceRange(source) }),
          });
          const readResult = await readResponse.json().catch(() => ({}));
          if (!readResponse.ok) throw new Error(readResult?.error || `Не удалось прочитать лист ${source.sheet_name}`);
          const sheetValues: string[][] = readResult.values || [];
          const rangeStartColumn = source.sheet_range.match(/^([A-Z]+)/)?.[1] || 'A';
          const rangeStartIndex = lettersToIndex(rangeStartColumn);
          const configuredColumns = Array.from(new Set(
            source.name_columns.split(':').map(column => lettersToIndex(column) - rangeStartIndex),
          ));
          const header = sheetValues[0] || [];
          const surnameHeaderIndex = header.findIndex(value => /фамил|прізв|surname|last.?name/i.test(String(value || '')));
          const nameHeaderIndex = header.findIndex(value => /имя|ім.?я|first.?name|name/i.test(String(value || '')));
          const columns = source.name_columns === 'A:Z' && (surnameHeaderIndex >= 0 || nameHeaderIndex >= 0)
            ? [surnameHeaderIndex >= 0 ? surnameHeaderIndex : nameHeaderIndex]
            : configuredColumns;
          const sourceNames = sheetValues.slice(1)
            .map(row => columns.map(column => String(row[column] || '')).join(' ').trim())
            .filter(Boolean);
          const usableSourceNames = sourceNames.filter(name =>
            normalizePerson(name).split(' ').filter(token => token.length >= 3).length >= 2,
          );
          if (sourceNames.length > 0 && usableSourceNames.length * 2 < sourceNames.length) {
            throw new Error(`\u0412 \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a\u0435 ${source.sheet_name || '\u0442\u0430\u0431\u043b\u0438\u0446\u0430'}:${source.name_columns} \u0431\u043e\u043b\u044c\u0448\u0438\u043d\u0441\u0442\u0432\u043e \u0441\u0442\u0440\u043e\u043a \u043d\u0435 \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u0438\u043c\u0435\u043d\u0438 \u0438 \u0444\u0430\u043c\u0438\u043b\u0438\u0438. \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u043e\u043b\u043e\u043d\u043a\u0443 \u0441 \u0418\u043c\u0435\u043d\u0435\u043c \u0438 \u0444\u0430\u043c\u0438\u043b\u0438\u0435\u0439 \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0430.`);
          }
          for (const row of sheetValues.slice(1)) {
            const name = columns.map(column => String(row[column] || '')).join(' ').trim();
            const tokens = normalizePerson(name).split(' ').filter(token => token.length >= 3);
            if (name && tokens.length >= 2) registrations.push({ name, tokens });
          }
        }

        const reportTransactions = (exportRows || []).filter(row => row.type === 'income');
        const matchedTransactionIds = registrations.map(registration =>
          reportTransactions.find(transaction =>
            registrationMatchesTransactionText(registration.tokens, transactionTitleOrDescriptionText(transaction)),
          )?.id || null,
        );
        const transactionsById = new Map(reportTransactions.map(transaction => [transaction.id, transaction]));
        const paidForByTransactionId = new Map<string, Array<{ name: string; tokens: string[] }>>();
        for (const [index, transactionId] of matchedTransactionIds.entries()) {
          if (!transactionId) continue;
          const paidFor = paidForByTransactionId.get(transactionId) || [];
          paidFor.push(registrations[index]);
          paidForByTransactionId.set(transactionId, paidFor);
        }
        // Keep every registration as its own row. A family payment is repeated
        // for each participant and explained in column C instead of removing
        // the other family members from the export.
        const reconciliationRows = registrations.map((registration, index): string[] => {
          const transactionId = matchedTransactionIds[index];
          if (!transactionId) return [registration.name, '', ''];
          const paidFor = paidForByTransactionId.get(transactionId) || [];
          const transaction = transactionsById.get(transactionId)!;
          const explanation = paidFor.length > 1
            ? familyPaymentExplanation(transaction, paidFor)
              || `Оплата за: ${paidFor.map(person => person.name).join(', ')}`
            : '';
          return [
            registration.name,
            exportNameFromPaymentText(transaction),
            explanation,
          ];
        });
        values.length = 0;
        values.push(
          [
            '\u0417\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0435 \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0438',
            '\u0422\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438 \u0441 \u0442\u0438\u0442\u0443\u043b\u0430 \u0438 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u044f',
            '\u041f\u043e\u044f\u0441\u043d\u0435\u043d\u0438\u0435',
          ],
          ...reconciliationRows,
        );
        const sheetsResponse = await fetch(`${supabaseUrl}/functions/v1/google-sheets`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
            'x-owner-user-id': linkData.owner_user_id,
          },
          body: JSON.stringify({ action: 'write', spreadsheetId: exportTarget.spreadsheet_id, range: sourceRange(exportTarget as ExportSource), values }),
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

    const [{ data: transactions, error: transactionsError }, { data: sheetsProfile }, { data: registrationSources }, { data: exportSources }] = await Promise.all([
      transactionsQuery,
      supabase
        .from('profiles')
        .select('spreadsheet_id, sheet_range')
        .eq('user_id', linkData.owner_user_id)
        .maybeSingle(),
      supabase
        .from('registration_sheet_sources')
        .select('id, spreadsheet_id, sheet_name, sheet_range, name_columns, amount_column')
        .eq('owner_user_id', linkData.owner_user_id)
        .order('created_at'),
      supabase
        .from('public_export_sheet_targets')
        .select('id, spreadsheet_id, sheet_name, sheet_range')
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
        exportSources: exportSources || [],
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
