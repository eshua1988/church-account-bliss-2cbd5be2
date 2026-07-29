import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://eshua1988.github.io/church-account-bliss-2cbd5be2";
const HISTORY_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ----- Google Sheets helper -----

async function getGoogleAccessToken(): Promise<string | null> {
  try {
    const rawCreds = Deno.env.get("GOOGLE_SHEETS_CREDENTIALS") || "{}";
    const credentials: { client_email?: string; private_key?: string } = JSON.parse(rawCreds);
    if (!credentials.client_email || !credentials.private_key) return null;

    const header = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    };

    const base64urlEncode = (obj: object) => {
      const json = JSON.stringify(obj);
      const bytes = new TextEncoder().encode(json);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };

    const headerEncoded = base64urlEncode(header);
    const claimEncoded = base64urlEncode(claim);
    const signatureInput = `${headerEncoded}.${claimEncoded}`;

    const pemContents = credentials.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/[\r\n\s]/g, "");

    const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(signatureInput),
    );
    const signatureEncoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const jwt = `${signatureInput}.${signatureEncoded}`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenResponse.json();
    return tokenData.access_token || null;
  } catch {
    return null;
  }
}

async function readSheetRange(
  spreadsheetId: string,
  range: string,
  accessToken: string,
): Promise<string[][] | null> {
  try {
    const encodedRange = encodeURIComponent(range);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await res.json();
    return (data.values as string[][] | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Read multiple ranges via batchGet, returns array of {range, values} */
async function readSheetRangesBatch(
  spreadsheetId: string,
  ranges: string[],
  accessToken: string,
): Promise<Array<{ range: string; values: string[][] }>> {
  try {
    const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await res.json();
    const vr = (data.valueRanges as Array<{ range: string; values?: string[][] }>) ?? [];
    return vr.map((r) => ({ range: r.range ?? '', values: r.values ?? [] }));
  } catch {
    return [];
  }
}

/** Build Google Sheets range string from structured SheetRange */
/** Build one or more range strings from a SheetRange (supports multiple cols and rows) */
function buildRangeStrings(r: {
  sheetName: string;
  // new format
  cols?: Array<{ from: string; to: string }>;
  rows?: Array<{ from: string; to: string }>;
  // legacy format
  colFrom?: string; colTo?: string; rowFrom?: string; rowTo?: string;
}): string[] {
  const prefix = r.sheetName ? `${r.sheetName}!` : '';
  const colPairs = (r.cols && r.cols.length > 0)
    ? r.cols
    : [{ from: r.colFrom ?? 'A', to: r.colTo ?? '' }];
  const rowPairs = (r.rows && r.rows.length > 0)
    ? r.rows
    : [{ from: r.rowFrom ?? '', to: r.rowTo ?? '' }];

  const results: string[] = [];
  for (const col of colPairs) {
    for (const row of rowPairs) {
      const cf = (col.from || '').toUpperCase();
      const ct = (col.to || col.from || '').toUpperCase() || cf;
      const rf = (row.from || '').trim();
      const rt = (row.to || '').trim();
      let seg: string;
      if (!cf && rf) seg = `${rf}:${rt || rf}`;
      else if (cf && !rf) seg = ct ? `${cf}:${ct}` : `${cf}:${cf}`;
      else if (cf && rf) seg = `${cf}${rf}:${ct || cf}${rt || rf}`;
      else seg = 'A:Z';
      results.push(`${prefix}${seg}`);
    }
  }
  return results.length > 0 ? results : [`${prefix}A:Z`];
}

/** @deprecated use buildRangeStrings */
function buildRangeString(r: { sheetName: string; colFrom: string; colTo: string; rowFrom: string; rowTo: string }): string {
  return buildRangeStrings(r)[0];
}

/** Build range strings with their column labels for display */
function buildRangeStringsWithLabels(r: {
  sheetName: string;
  cols?: Array<{ id: string; from: string; to: string; label?: string }>;
  rows?: Array<{ id: string; from: string; to: string }>;
  colFrom?: string; colTo?: string; rowFrom?: string; rowTo?: string;
}): Array<{ range: string; colLabel?: string }> {
  const prefix = r.sheetName ? `${r.sheetName}!` : '';
  const colPairs = r.cols?.length
    ? r.cols
    : [{ from: r.colFrom ?? 'A', to: r.colTo ?? '', label: undefined as string | undefined }];
  const rowPairs = r.rows?.length
    ? r.rows
    : [{ from: r.rowFrom ?? '', to: r.rowTo ?? '' }];

  const results: Array<{ range: string; colLabel?: string }> = [];
  for (const col of colPairs) {
    for (const row of rowPairs) {
      const cf = (col.from || '').toUpperCase();
      const ct = (col.to || col.from || '').toUpperCase() || cf;
      const rf = (row.from || '').trim();
      const rt = (row.to || '').trim();
      let seg: string;
      if (!cf && rf) seg = `${rf}:${rt || rf}`;
      else if (cf && !rf) seg = ct ? `${cf}:${ct}` : `${cf}:${cf}`;
      else if (cf && rf) seg = `${cf}${rf}:${ct || cf}${rt || rf}`;
      else seg = 'A:Z';
      results.push({ range: `${prefix}${seg}`, colLabel: (col as any).label || undefined });
    }
  }
  return results.length > 0 ? results : [{ range: `${prefix}A:Z` }];
}

/** Format 2D sheet data for Telegram HTML message with column alignment */
function formatSheetData(values: string[][], title: string, range: string, headerLabels?: string[]): string {
  const MAX_LEN = 3800;
  if (!values || values.length === 0) return '';

  // Merge custom labels as header row if provided
  const rows = headerLabels && headerLabels.length > 0
    ? [headerLabels, ...values]
    : values;

  // Compute max width per column
  const colCount = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: colCount }, (_, ci) =>
    Math.min(30, Math.max(...rows.map((r) => String(r[ci] ?? '').length)))
  );

  const pad = (s: string, w: number) => {
    const str = String(s ?? '').slice(0, w);
    return str + ' '.repeat(Math.max(0, w - str.length));
  };

  const lines: string[] = [];
  // Header with button name (only if label row is custom), otherwise use first spreadsheet row as-is
  if (headerLabels && headerLabels.length > 0) {
    lines.push(`<b>📈 ${escapeHtml(title)}</b>`);
  }

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const cells = widths.map((w, ci) => pad(String(row[ci] ?? ''), w));
    const line = cells.join(' | ');
    if (ri === 0 && rows.length > 1) {
      // Header row in bold
      lines.push(`<b>${escapeHtml(line)}</b>`);
      lines.push('—'.repeat(Math.min(60, line.length)));
    } else {
      lines.push(escapeHtml(line));
    }
  }

  let text = (headerLabels ? '' : `<b>📈 ${escapeHtml(title)}</b>\n<i>${escapeHtml(range)}</i>\n\n`) + lines.join('\n');
  if (text.length > MAX_LEN) {
    text = text.slice(0, MAX_LEN) + '\n…';
  }
  return text;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sanitize user-authored HTML for Telegram HTML parse mode.
 * Preserves valid Telegram HTML formatting tags; escapes &, <, > in all
 * plain-text segments so the Telegram HTML parser doesn't choke.
 */
function sanitizeTelegramHtml(text: string): string {
  // Tags allowed by Telegram HTML mode
  const ALLOWED_TAG = /<\/?(?:b|strong|i|em|u|s|strike|del|code|pre|tg-spoiler|blockquote)>|<a\s[^>]{0,400}>|<\/a>|<tg-emoji[^>]{0,100}>|<\/tg-emoji>/gi;
  const parts: string[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  ALLOWED_TAG.lastIndex = 0;
  while ((m = ALLOWED_TAG.exec(text)) !== null) {
    if (m.index > lastIdx) {
      const seg = text.slice(lastIdx, m.index);
      parts.push(seg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    }
    parts.push(m[0]);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    const seg = text.slice(lastIdx);
    parts.push(seg.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  }
  return parts.join("");
}

/**
 * Format rows as aligned table wrapped in <pre> for monospace rendering in Telegram.
 * - Filters out rows where every cell is empty/whitespace.
 * - Optional colLabels: shown as bold header row before <pre> block.
 * - Last column is right-aligned (for numeric values), others left-aligned.
 */
function formatTableRows(rows: string[][], colLabels?: string[]): string {
  if (!rows.length) return '';
  // Skip fully-empty rows
  const dataRows = rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (!dataRows.length) return '';

  const hasLabels = colLabels && colLabels.some((l) => l.trim() !== '');
  const allRows = hasLabels ? [colLabels!, ...dataRows] : dataRows;
  const colCount = Math.max(...allRows.map((r) => r.length));

  const widths = Array.from({ length: colCount }, (_, ci) =>
    Math.min(24, Math.max(1, ...allRows.map((r) => String(r[ci] ?? '').length)))
  );

  const padL = (s: string, w: number) => {
    const str = String(s ?? '').slice(0, w);
    return str + ' '.repeat(Math.max(0, w - str.length));
  };
  const padR = (s: string, w: number) => {
    const str = String(s ?? '').slice(0, w);
    return ' '.repeat(Math.max(0, w - str.length)) + str;
  };
  const fmtRow = (row: string[]): string =>
    widths.map((w, ci) => {
      const cell = String(row[ci] ?? '');
      return ci === colCount - 1 ? padR(cell, w) : padL(cell, w);
    }).join(' │ ');

  const parts: string[] = [];
  if (hasLabels) {
    parts.push(`<b>${escapeHtml(fmtRow(colLabels!))}</b>`);
  }
  const preContent = dataRows.map((r) => escapeHtml(fmtRow(r))).join('\n');
  parts.push(`<pre>${preContent}</pre>`);
  return parts.join('\n');
}

// ----- Telegram helpers -----

// Returns message_id of the sent message (for history tracking), or null on error.
async function sendMessage(chatId: number, text: string, replyMarkup?: object, token?: string): Promise<number | null> {
  const botToken = token || TELEGRAM_BOT_TOKEN;
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  return (result.ok && result.result?.message_id) ? (result.result.message_id as number) : null;
}

async function deleteMessage(chatId: number, messageId: number, token: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  });
}

async function answerCallbackQuery(callbackQueryId: string, token?: string) {
  await fetch(`https://api.telegram.org/bot${token || TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

// ----- Per-user bot token -----

async function getBotToken(chatId: number, supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await supabase
    .from("telegram_users")
    .select("bot_token")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as { bot_token: string | null } | null)?.bot_token || TELEGRAM_BOT_TOKEN;
}

// ----- History management -----

// Checks if user was inactive for 6+ hours. If so, deletes all old bot messages
// and clears DB. Returns the current stored IDs (empty if cleared).
async function clearStaleHistory(
  chatId: number,
  supabase: ReturnType<typeof createClient>,
  botToken: string,
): Promise<number[]> {
  try {
    const { data } = await supabase
      .from("telegram_users")
      .select("last_active_at, bot_message_ids")
      .eq("telegram_chat_id", chatId)
      .eq("is_active", true)
      .maybeSingle();

    const row = data as { last_active_at: string | null; bot_message_ids: number[] | null } | null;
    if (!row) return [];

    const lastActive = row.last_active_at ? new Date(row.last_active_at).getTime() : 0;
    const storedIds: number[] = row.bot_message_ids || [];
    const isStale = Date.now() - lastActive > HISTORY_TTL_MS;

    if (isStale && storedIds.length > 0) {
      // Delete all tracked bot messages (ignore errors for already-deleted ones)
      await Promise.allSettled(storedIds.map(id => deleteMessage(chatId, id, botToken)));
      await supabase
        .from("telegram_users")
        .update({ bot_message_ids: [] })
        .eq("telegram_chat_id", chatId);
      return [];
    }

    return storedIds;
  } catch {
    return []; // columns may not exist yet after migration — proceed silently
  }
}

// Appends new message IDs and updates last_active_at in DB.
async function saveTrackedIds(
  chatId: number,
  existingIds: number[],
  newIds: number[],
  supabase: ReturnType<typeof createClient>,
): Promise<void> {
  if (newIds.length === 0) return;
  try {
    await supabase
      .from("telegram_users")
      .update({
        last_active_at: new Date().toISOString(),
        bot_message_ids: [...existingIds, ...newIds],
      })
      .eq("telegram_chat_id", chatId);
  } catch {
    // silently ignore if columns not yet migrated
  }
}

// ----- Bot i18n (system messages) -----
type BotLang = 'ru' | 'uk' | 'en' | 'pl';

const botI18n: Record<string, Record<BotLang, string>> = {
  welcomeFallback: {
    ru: '👋 Выберите действие:',
    uk: '👋 Оберіть дію:',
    en: '👋 Choose an action:',
    pl: '👋 Wybierz akcję:',
  },
  fallbackButton: {
    ru: '🔗 Ссылка ордера расходов',
    uk: '🔗 Посилання ордера витрат',
    en: '🔗 Expense order link',
    pl: '🔗 Link zamówienia wydatków',
  },
  noGoogleAccess: {
    ru: '❌ Не удалось получить доступ к Google Таблице.',
    uk: '❌ Не вдалося отримати доступ до Google Таблиці.',
    en: '❌ Failed to access the Google Sheet.',
    pl: '❌ Nie udało się uzyskać dostępu do Arkusza Google.',
  },
  googleNotConfigured: {
    ru: '❌ Google Таблица не настроена в профиле.',
    uk: '❌ Google Таблиця не налаштована в профілі.',
    en: '❌ Google Sheet is not configured in the profile.',
    pl: '❌ Arkusz Google nie jest skonfigurowany w profilu.',
  },
};

function getLang(
  botSettings: Record<string, unknown> | null | undefined,
  tgLangCode?: string,
): BotLang {
  const configured = (botSettings?.language as string) ?? 'ru';
  if (configured === 'auto') {
    const code = (tgLangCode ?? '').split('-')[0].toLowerCase();
    if (['ru', 'be', 'kk', 'ky', 'tg', 'uz'].includes(code)) return 'ru';
    if (code === 'uk') return 'uk';
    if (code === 'pl') return 'pl';
    return 'en';
  }
  const supported: BotLang[] = ['ru', 'uk', 'en', 'pl'];
  return supported.includes(configured as BotLang) ? (configured as BotLang) : 'ru';
}

// ----- Dynamic main menu -----

async function buildMainMenuForUser(
  userId: string,
  supabase: ReturnType<typeof createClient>,
  tgUserLangCode?: string,
  botId?: string | null,
): Promise<{ keyboard: object; welcomeMessage: string }> {
  // Read custom bot config
  const { data: config } = await supabase
    .from("telegram_bot_config")
    .select("welcome_message, extra_buttons, message_templates, menu_order, button_layout, bot_settings")
    .eq("user_id", userId)
    .maybeSingle();

  const lang = getLang((config as any)?.bot_settings, tgUserLangCode);
  const welcomeMessage = sanitizeTelegramHtml((config as any)?.welcome_message ?? botI18n.welcomeFallback[lang]);
  const extraButtons: Array<{ id: string; text: string; type: string; value: string }> =
    ((config as any)?.extra_buttons) ?? [];
  const messageTemplates: Array<{
    id: string; title: string; text: string; trigger: string; enabled: boolean;
    buttons: Array<{ id: string; label: string; copyText: string }>;
  }> = ((config as any)?.message_templates) ?? [];
  const menuOrder: Array<{ id: string; kind: string }> =
    ((config as any)?.menu_order) ?? [];
  const buttonsPerRow: number = Math.min(3, Math.max(1, Number((config as any)?.button_layout?.buttonsPerRow ?? 1)));

  const btnMap = new Map(extraButtons.map((b) => [b.id, b]));
  const tmplMap = new Map(messageTemplates.filter((t) => t.enabled && t.trigger).map((t) => [t.id, t]));

  // Build unified order: use menuOrder if available, else buttons then templates
  const orderedIds: Array<{ id: string; kind: string }> =
    menuOrder.length > 0
      ? menuOrder
      : [
          ...extraButtons.map((b) => ({ id: b.id, kind: "button" })),
          ...messageTemplates.filter((t) => t.enabled).map((t) => ({ id: t.id, kind: "template" })),
        ];

  // Build flat list of button objects with per-item newRow flag
  type FlatItem = { btn: Record<string, unknown>; newRow: boolean };
  const flatItems: FlatItem[] = [];

  for (const entry of orderedIds) {
    try {
      const forceNewRow = (entry as any).newRow === true;
      let flatBtn: Record<string, unknown> | null = null;

      if (entry.kind === "button") {
        const btn = btnMap.get(entry.id);
        if (!btn || (btn as any).enabled === false) continue;
        if (btn.type === "copy" && btn.value) {
          flatBtn = { text: btn.text, copy_text: { text: btn.value } };
        } else if (btn.type === "url" && btn.value) {
          flatBtn = { text: btn.text, url: btn.value };
        } else if (btn.type === "callback" && btn.value) {
          flatBtn = { text: btn.text, callback_data: btn.value };
        } else if (btn.type === "google_sheet") {
          flatBtn = { text: btn.text, callback_data: `gsheet_${btn.id}` };
        } else if (btn.type === "web_app" && btn.value) {
          flatBtn = { text: btn.text, web_app: { url: btn.value } };
        } else if (btn.type === "switch_inline") {
          flatBtn = { text: btn.text, switch_inline_query: btn.value ?? "" };
        } else if (btn.type === "switch_inline_current") {
          flatBtn = { text: btn.text, switch_inline_query_current_chat: btn.value ?? "" };
        } else if (btn.type === "hashtag" && btn.value) {
          const tag = btn.value.startsWith("#") ? btn.value : `#${btn.value}`;
          flatBtn = { text: btn.text, switch_inline_query_current_chat: tag };
        }
      } else if (entry.kind === "template") {
        const tmpl = tmplMap.get(entry.id);
        if (!tmpl) continue;
        flatBtn = { text: tmpl.title || tmpl.trigger, callback_data: tmpl.trigger };
      }

      if (flatBtn) flatItems.push({ btn: flatBtn, newRow: forceNewRow });
    } catch {
      // Skip malformed entry so it doesn't break the entire keyboard
    }
  }

  const { data: registrationEvents } = await supabase
    .from("registration_events")
    .select("id, title, button_text, starts_at, telegram_bot_ids")
    .eq("user_id", userId)
    .eq("is_published", true)
    .or(`starts_at.is.null,starts_at.gte.${new Date().toISOString()}`)
    .order("starts_at", { ascending: true, nullsFirst: false })
    .limit(20);

  for (const event of registrationEvents ?? []) {
    const assignedBots = Array.isArray((event as any).telegram_bot_ids)
      ? (event as any).telegram_bot_ids as string[]
      : [];
    if (assignedBots.length > 0 && (!botId || !assignedBots.includes(botId))) continue;
    const buttonLabel = String(event.button_text || "Зарегистрироваться").trim();
    const title = String(event.title || "").trim();
    flatItems.push({
      btn: {
        text: `📅 ${buttonLabel}: ${title}`.slice(0, 64),
        callback_data: `event_${event.id}`,
      },
      newRow: true,
    });
  }

  // Build rows: respect per-item newRow flag and global buttonsPerRow limit
  const buttons: Array<Array<Record<string, unknown>>> = [];
  let currentRow: Record<string, unknown>[] = [];
  for (const item of flatItems) {
    if (item.newRow && currentRow.length > 0) {
      buttons.push(currentRow);
      currentRow = [];
    }
    currentRow.push(item.btn);
    if (currentRow.length >= buttonsPerRow) {
      buttons.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) buttons.push(currentRow);

  if (buttons.length === 0) {
    buttons.push([{ text: botI18n.fallbackButton[lang], callback_data: "get_links" }]);
  }

  return { keyboard: { inline_keyboard: buttons }, welcomeMessage };
}

// ----- Resolve bot owner (no account linking required) -----
// Priority: 1) owner encoded in webhook URL, 2) direct chatId link, 3) first active user (shared public bot)
async function resolveBotOwner(
  chatId: number,
  ownerFromUrl: string | null,
  botIdFromUrl: string | null,
  supabase: ReturnType<typeof createClient>,
): Promise<{ userId: string | null; botToken: string; botId: string | null }> {
  // 1) Owner encoded in webhook URL (custom bots set this when activating webhook)
  if (ownerFromUrl) {
    let query = supabase
      .from("telegram_users")
      .select("id, bot_token")
      .eq("user_id", ownerFromUrl)
      .eq("is_active", true);
    if (botIdFromUrl) query = query.eq("id", botIdFromUrl);
    const { data } = await query.limit(1).maybeSingle();
    return {
      userId: ownerFromUrl,
      botToken: (data as any)?.bot_token || TELEGRAM_BOT_TOKEN,
      botId: (data as any)?.id ?? botIdFromUrl,
    };
  }

  // 2) Direct link: the sender has their own account linked
  const { data: direct } = await supabase
    .from("telegram_users")
    .select("id, user_id, bot_token")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();
  if (direct) {
    return {
      userId: (direct as any).user_id,
      botToken: (direct as any).bot_token || TELEGRAM_BOT_TOKEN,
      botId: (direct as any).id,
    };
  }

  // 3) Fall back to first active user (shared public bot — anyone can use it)
  const { data: anyUser } = await supabase
    .from("telegram_users")
    .select("id, user_id, bot_token")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return {
    userId: (anyUser as any)?.user_id ?? null,
    botToken: (anyUser as any)?.bot_token || TELEGRAM_BOT_TOKEN,
    botId: (anyUser as any)?.id ?? null,
  };
}

// ----- Business logic (resend menu on get_links) -----

async function handleGetLinks(
  chatId: number,
  botOwnerId: string | null,
  supabase: ReturnType<typeof createClient>,
  botToken: string,
  tgUserLangCode?: string,
  botId?: string | null,
): Promise<number | null> {
  if (!botOwnerId) {
    return sendMessage(chatId, botI18n.welcomeFallback[getLang(null, tgUserLangCode)], undefined, botToken);
  }
  const { keyboard, welcomeMessage } = await buildMainMenuForUser(botOwnerId, supabase, tgUserLangCode, botId);
  return sendMessage(chatId, welcomeMessage, keyboard, botToken);
}

type RegistrationField = {
  id: string;
  label: string;
  type: "text" | "phone" | "email" | "number";
  required?: boolean;
};

function registrationPrompt(field: RegistrationField): { text: string; keyboard?: object } {
  const required = field.required ? " *" : "";
  if (field.type === "phone") {
    return {
      text: `📱 Введите «${escapeHtml(field.label)}»${required} или отправьте контакт кнопкой ниже.`,
      keyboard: {
        keyboard: [[{ text: "Отправить номер телефона", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    };
  }
  return { text: `✍️ Введите «${escapeHtml(field.label)}»${required}:` };
}

function validRegistrationAnswer(field: RegistrationField, value: string): boolean {
  if (!value.trim()) return !field.required;
  if (field.type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  if (field.type === "phone") return value.replace(/\D/g, "").length >= 7;
  if (field.type === "number") return Number.isFinite(Number(value.replace(",", ".")));
  return true;
}

/** A final review keeps an accidental or incomplete chat exchange from becoming
 * a registration.  Telegram has no native multi-step form, so this is the
 * equivalent of the review page before submitting a Google Form. */
function registrationReview(event: { title?: string; form_fields?: unknown }, answers: Record<string, string>): string {
  const fields = (Array.isArray(event.form_fields) ? event.form_fields : []) as RegistrationField[];
  const rows = fields
    .filter((field) => answers[field.id] !== undefined && String(answers[field.id]).trim() !== "")
    .map((field) => `<b>${escapeHtml(field.label)}:</b> ${escapeHtml(String(answers[field.id]))}`);
  return `📋 <b>Проверьте анкету</b>\n<b>${escapeHtml(event.title || "Мероприятие")}</b>\n\n${rows.join("\n") || "Нет заполненных полей."}\n\nНажмите «Подтвердить», чтобы завершить регистрацию.`;
}

function registrationReviewKeyboard(eventId: string): object {
  return {
    inline_keyboard: [
      [{ text: "✅ Подтвердить регистрацию", callback_data: `event_confirm_${eventId}` }],
      [{ text: "✏️ Заполнить заново", callback_data: `event_restart_${eventId}` }],
      [{ text: "◀ В меню", callback_data: "get_links" }],
    ],
  };
}

// ----- Webhook setup helper -----

async function setWebhook(token: string, webhookUrl: string): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, drop_pending_updates: true }),
  });
  return res.json();
}

// ----- Main handler -----

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Setup shared bot webhook
  if (url.searchParams.get("setup") === "true") {
    const ownerId = url.searchParams.get("owner_id");
    const webhookUrl = ownerId
      ? `${SUPABASE_URL}/functions/v1/telegram-bot?owner=${ownerId}`
      : `${SUPABASE_URL}/functions/v1/telegram-bot`;
    const getMeRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
    const getMeResult = await getMeRes.json();
    if (!getMeResult.ok) {
      return new Response(JSON.stringify({ ok: false, description: "Invalid shared bot token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await setWebhook(TELEGRAM_BOT_TOKEN, webhookUrl);
    return new Response(JSON.stringify({ ...result, bot: getMeResult.result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Setup custom bot webhook
  if (url.searchParams.get("setup_custom") === "true" && req.method === "POST") {
    try {
      const { bot_token, user_id, bot_id } = await req.json() as { bot_token: string; user_id?: string; bot_id?: string };
      if (!bot_token) {
        return new Response(JSON.stringify({ ok: false, description: "bot_token required" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const getMeRes = await fetch(`https://api.telegram.org/bot${bot_token}/getMe`);
      const getMeResult = await getMeRes.json();
      if (!getMeResult.ok) {
        return new Response(JSON.stringify({ ok: false, description: "Invalid bot token" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Encode the bot owner in the webhook URL so all users' messages are served from their config
      let resolvedBotId = bot_id;
      if (!resolvedBotId && user_id) {
        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: storedBot } = await admin
          .from("telegram_users")
          .select("id")
          .eq("user_id", user_id)
          .eq("bot_token", bot_token)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        resolvedBotId = (storedBot as any)?.id;
      }
      const webhookUrl = user_id
        ? `${SUPABASE_URL}/functions/v1/telegram-bot?owner=${user_id}${resolvedBotId ? `&bot_id=${resolvedBotId}` : ""}`
        : `${SUPABASE_URL}/functions/v1/telegram-bot`;
      const result = await setWebhook(bot_token, webhookUrl);
      return new Response(JSON.stringify({ ...result, bot: getMeResult.result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error("setup_custom error:", e);
      return new Response(JSON.stringify({ ok: false, description: "Server error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Send test message to all connected bots for authenticated user
  if (url.searchParams.get("send_test") === "true" && req.method === "GET") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(SUPABASE_URL, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: bots } = await supabase
      .from("telegram_users")
      .select("bot_token, telegram_chat_id")
      .eq("user_id", user.id)
      .eq("is_active", true);
    if (!bots || bots.length === 0) {
      return new Response(JSON.stringify({ ok: false, description: "No active bots" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { keyboard, welcomeMessage } = await buildMainMenuForUser(user.id, supabase);
    let sent = 0;
    for (const bot of bots as Array<{ bot_token: string | null; telegram_chat_id: number }>) {
      try {
        const msgId = await sendMessage(
          bot.telegram_chat_id,
          welcomeMessage,
          keyboard,
          bot.bot_token || TELEGRAM_BOT_TOKEN,
        );
        if (msgId) sent++;
      } catch { /* skip individual errors */ }
    }
    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Handle Telegram updates (webhook)
  if (req.method === "POST") {
    try {
      const update = await req.json();
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Determine chat ID from any update type
      let chatId: number | null = null;
      if (update.message?.chat?.type === "private") {
        chatId = update.message.chat.id as number;
      } else if (update.callback_query) {
        chatId = update.callback_query.message.chat.id as number;
      }

      if (chatId) {
        // Resolve bot owner & token without requiring the sender to be linked
        const ownerFromUrl = url.searchParams.get("owner");
        const userLangCode: string = update.message?.from?.language_code ?? update.callback_query?.from?.language_code ?? '';
        const botIdFromUrl = url.searchParams.get("bot_id");
        const { userId: botOwnerId, botToken, botId } = await resolveBotOwner(chatId, ownerFromUrl, botIdFromUrl, supabase);

        // Clear history if user was inactive for 6+ hours (only applies for linked users)
        const existingIds = await clearStaleHistory(chatId, supabase, botToken);
        const newIds: number[] = [];

        // Regular message: continue an active event form, otherwise show the menu.
        if (update.message?.chat?.type === "private") {
          const telegramUser = update.message.from ?? {};
          let sessionQuery = supabase
            .from("event_registration_sessions")
            .select("*, registration_events(*)")
            .eq("telegram_user_id", Number(telegramUser.id))
            .order("updated_at", { ascending: false });
          if (botId) sessionQuery = sessionQuery.eq("bot_id", botId);
          const { data: session } = await sessionQuery
            .limit(1)
            .maybeSingle();

          if (session && botOwnerId) {
            const event = (session as any).registration_events;
            const fields = (Array.isArray(event?.form_fields) ? event.form_fields : []) as RegistrationField[];
            const index = Number((session as any).current_field_index || 0);
            const field = fields[index];
            const answer = String(update.message.contact?.phone_number ?? update.message.text ?? "").trim();

            if (index === -1) {
              const msgId = await sendMessage(
                chatId,
                registrationReview(event, (session as any).answers ?? {}),
                registrationReviewKeyboard(event.id),
                botToken,
              );
              if (msgId) newIds.push(msgId);
            } else if (!field || !validRegistrationAnswer(field, answer)) {
              const prompt = field
                ? registrationPrompt(field)
                : { text: "Не удалось продолжить анкету. Нажмите кнопку регистрации ещё раз." };
              const msgId = await sendMessage(
                chatId,
                field ? `⚠️ Проверьте значение.\n${prompt.text}` : prompt.text,
                prompt.keyboard,
                botToken,
              );
              if (msgId) newIds.push(msgId);
            } else {
              const answers = { ...((session as any).answers ?? {}), [field.id]: answer };
              const nextIndex = index + 1;
              if (nextIndex < fields.length) {
                await supabase
                  .from("event_registration_sessions")
                  .update({ answers, current_field_index: nextIndex, updated_at: new Date().toISOString() })
                  .eq("id", (session as any).id);
                const prompt = registrationPrompt(fields[nextIndex]);
                const msgId = await sendMessage(chatId, `Шаг ${nextIndex + 1} из ${fields.length}. ${prompt.text}`, prompt.keyboard, botToken);
                if (msgId) newIds.push(msgId);
              } else {
                // Do not persist yet.  The person gets a complete, readable
                // form summary and explicitly submits it on the next step.
                await supabase
                  .from("event_registration_sessions")
                  .update({ answers, current_field_index: -1, updated_at: new Date().toISOString() })
                  .eq("id", (session as any).id);
                const msgId = await sendMessage(chatId, registrationReview(event, answers), registrationReviewKeyboard(event.id), botToken);
                if (msgId) newIds.push(msgId);
              }
            }
          } else {
            const { keyboard, welcomeMessage } = botOwnerId
              ? await buildMainMenuForUser(botOwnerId, supabase, userLangCode, botId)
              : { keyboard: { inline_keyboard: [] as any }, welcomeMessage: botI18n.welcomeFallback[getLang(null, userLangCode)] };
            const msgId = await sendMessage(chatId, welcomeMessage, keyboard, botToken);
            if (msgId) newIds.push(msgId);
          }
        }

        // Inline button press
        if (update.callback_query) {
          await answerCallbackQuery(update.callback_query.id, botToken);
          const callbackData: string = update.callback_query.data || "";

          if (callbackData === "get_links") {
            const msgId = await handleGetLinks(chatId, botOwnerId, supabase, botToken, userLangCode, botId);
            if (msgId) newIds.push(msgId);
          } else if (callbackData.startsWith("event_confirm_") || callbackData.startsWith("event_restart_")) {
            const confirm = callbackData.startsWith("event_confirm_");
            const eventId = callbackData.slice(confirm ? "event_confirm_".length : "event_restart_".length);
            const telegramUser = update.callback_query.from ?? {};
            if (botOwnerId && /^[0-9a-f-]{36}$/i.test(eventId)) {
              const { data: session } = await supabase
                .from("event_registration_sessions")
                .select("*, registration_events(*)")
                .eq("event_id", eventId)
                .eq("telegram_user_id", Number(telegramUser.id))
                .maybeSingle();
              const event = (session as any)?.registration_events;
              const fields = (Array.isArray(event?.form_fields) ? event.form_fields : []) as RegistrationField[];
              if (!session || !event) {
                const msgId = await sendMessage(chatId, "Анкета не найдена. Нажмите кнопку регистрации ещё раз.", undefined, botToken);
                if (msgId) newIds.push(msgId);
              } else if (!confirm) {
                await supabase.from("event_registration_sessions").update({ answers: {}, current_field_index: 0, updated_at: new Date().toISOString() }).eq("id", (session as any).id);
                const prompt = fields[0] ? registrationPrompt(fields[0]) : { text: "Для этого мероприятия не настроены поля анкеты." };
                const msgId = await sendMessage(chatId, `✏️ Начнём заново.\n\n${prompt.text}`, prompt.keyboard, botToken);
                if (msgId) newIds.push(msgId);
              } else if (Number((session as any).current_field_index) !== -1) {
                const msgId = await sendMessage(chatId, "Сначала заполните анкету до конца.", undefined, botToken);
                if (msgId) newIds.push(msgId);
              } else {
                const answers = (session as any).answers ?? {};
                const { data: registrationResult, error: registrationError } = await supabase.rpc("register_telegram_for_event", {
                  target_event_id: event.id, target_owner_user_id: botOwnerId,
                  target_telegram_user_id: Number(telegramUser.id), target_telegram_chat_id: chatId,
                  target_first_name: answers.first_name || telegramUser.first_name || null,
                  target_last_name: answers.last_name || telegramUser.last_name || null,
                  target_username: telegramUser.username ?? null, target_answers: answers,
                });
                const result = registrationResult as any;
                let text = registrationError || !result?.success
                  ? (result?.code === "already_registered" ? "Вы уже зарегистрированы на это мероприятие." : "Не удалось сохранить регистрацию.")
                  : `✅ <b>${escapeHtml(result.title || event.title || "")}</b>\n${escapeHtml(result.confirmation_text || "Регистрация подтверждена!")}`;
                let keyboard: object = { remove_keyboard: true };
                if (result?.success && result.payment_required) {
                  text += `\n\n💳 <b>К оплате: ${escapeHtml(String(result.price ?? ""))} ${escapeHtml(result.currency || "PLN")}</b>`;
                  if (result.payment_instructions) text += `\n${escapeHtml(result.payment_instructions)}`;
                  keyboard = result.payment_url
                    ? { inline_keyboard: [[{ text: "Оплатить", url: result.payment_url }], [{ text: "◀ В меню", callback_data: "get_links" }]] }
                    : { inline_keyboard: [[{ text: "◀ В меню", callback_data: "get_links" }]] };
                }
                const msgId = await sendMessage(chatId, text, keyboard, botToken);
                if (msgId) newIds.push(msgId);
              }
            }
          } else if (callbackData.startsWith("event_")) {
            const eventId = callbackData.slice(6);
            const telegramUser = update.callback_query.from ?? {};
            if (botOwnerId && /^[0-9a-f-]{36}$/i.test(eventId)) {
              const { data: event } = await supabase
                .from("registration_events")
                .select("*")
                .eq("id", eventId)
                .eq("user_id", botOwnerId)
                .eq("is_published", true)
                .maybeSingle();
              const fields = (Array.isArray((event as any)?.form_fields) ? (event as any).form_fields : []) as RegistrationField[];
              await supabase.from("event_registration_sessions").upsert({
                event_id: eventId,
                bot_id: botId,
                telegram_user_id: Number(telegramUser.id),
                telegram_chat_id: chatId,
                current_field_index: 0,
                answers: {},
                telegram_profile: telegramUser,
                updated_at: new Date().toISOString(),
              }, { onConflict: "event_id,telegram_user_id" });
              const prompt = fields[0]
                ? registrationPrompt(fields[0])
                : { text: "Для этого мероприятия не настроены поля анкеты." };
              const description = String((event as any)?.description || "").trim();
              const intro = event
                ? `📋 <b>${escapeHtml((event as any).title || "Анкета")}</b>${description ? `\n${escapeHtml(description)}` : ""}\n\nШаг 1 из ${fields.length}. ${prompt.text}`
                : prompt.text;
              const msgId = await sendMessage(chatId, intro, prompt.keyboard, botToken);
              if (msgId) newIds.push(msgId);
            }
          } else if (callbackData.startsWith("gsheet_")) {
            // Google Sheet data button — use bot owner's config
            const userId2 = botOwnerId;
            if (userId2) {
              const btnId = callbackData.slice(7); // strip "gsheet_"
              const { data: cfg2 } = await supabase
                .from("telegram_bot_config")
                .select("extra_buttons, bot_settings")
                .eq("user_id", userId2)
                .maybeSingle();
              const gsheetLang = getLang((cfg2 as any)?.bot_settings, userLangCode);
              type SheetRangeCfg = {
                id: string; sheetName: string;
                cols?: Array<{ id: string; from: string; to: string }>;
                rows?: Array<{ id: string; from: string; to: string }>;
                colFrom?: string; colTo?: string; rowFrom?: string; rowTo?: string;
              };
              const extraBtns = ((cfg2 as any)?.extra_buttons as Array<{
                id: string; text: string; type: string; value: string;
                sheetRanges?: SheetRangeCfg[];
              }>) ?? [];
              const sheetBtn = extraBtns.find((b) => b.id === btnId && b.type === "google_sheet");
              const hasStructuredRanges = sheetBtn && Array.isArray(sheetBtn.sheetRanges) && sheetBtn.sheetRanges.length > 0;
              if (sheetBtn && (hasStructuredRanges || sheetBtn.value)) {
                // Get spreadsheet_id from user profile
                const { data: profile } = await supabase
                  .from("profiles")
                  .select("spreadsheet_id")
                  .eq("user_id", userId2)
                  .maybeSingle();
                const spreadsheetId = (profile as any)?.spreadsheet_id as string | null;
                if (spreadsheetId) {
                  const accessToken = await getGoogleAccessToken();
                  if (accessToken) {
                    const backKbd = { inline_keyboard: [[{ text: "◀ Назад", callback_data: "get_links" }]] };
                    if (hasStructuredRanges) {
                      let textParts: string[] = [];

                      for (const sheetRange of sheetBtn.sheetRanges!) {
                        const prefix = sheetRange.sheetName ? `${sheetRange.sheetName}!` : '';
                        const colPairs = sheetRange.cols?.length
                          ? sheetRange.cols
                          : [{ from: sheetRange.colFrom ?? 'A', to: sheetRange.colTo ?? '' }];
                        const rowPairs = sheetRange.rows?.length
                          ? sheetRange.rows
                          : [{ from: sheetRange.rowFrom ?? '', to: sheetRange.rowTo ?? '' }];

                        for (const row of rowPairs) {
                          const rf = (row.from || '').trim();
                          const rt = (row.to || '').trim();

                          // Build all col-range strings for this row pair
                          const colRangeStrings = colPairs.map((col) => {
                            const cf = (col.from || '').toUpperCase();
                            const ct = (col.to || col.from || '').toUpperCase() || cf;
                            let seg: string;
                            if (!cf && rf) seg = `${rf}:${rt || rf}`;
                            else if (cf && !rf) seg = ct ? `${cf}:${ct}` : `${cf}:${cf}`;
                            else if (cf && rf) seg = `${cf}${rf}:${ct || cf}${rt || rf}`;
                            else seg = 'A:Z';
                            return `${prefix}${seg}`;
                          });

                          // Collect column labels (one per colPair) for display as header
                          const colLabels = colPairs.map((col) => (col as any).label ?? '');

                          // Fetch all col ranges and merge horizontally (row by row)
                          let mergedValues: string[][] = [];
                          if (colRangeStrings.length === 1) {
                            mergedValues = (await readSheetRange(spreadsheetId, colRangeStrings[0], accessToken)) ?? [];
                          } else {
                            const batchResults = await readSheetRangesBatch(spreadsheetId, colRangeStrings, accessToken);
                            const maxLen = Math.max(0, ...batchResults.map((r) => r.values.length));
                            mergedValues = Array.from({ length: maxLen }, (_, ri) =>
                              batchResults.flatMap((r) => r.values[ri] ?? [])
                            );
                          }

                          if (mergedValues.length > 0) {
                            const labels = colLabels.some((l: string) => l.trim()) ? colLabels : undefined;
                            textParts.push(formatTableRows(mergedValues, labels));
                          }
                        }
                      }

                      if (textParts.length > 0) {
                        let fullText = `<b>📈 ${escapeHtml(sheetBtn.text)}</b>\n\n` + textParts.join('\n\n');
                        if (fullText.length > 3800) fullText = fullText.slice(0, 3800) + '\n…';
                        const msgId = await sendMessage(chatId, fullText, backKbd, botToken);
                        if (msgId) newIds.push(msgId);
                      } else {
                        const msgId = await sendMessage(chatId, `⚠️ Данные не найдены в указанных диапазонах.`, backKbd, botToken);
                        if (msgId) newIds.push(msgId);
                      }
                    } else {
                      // Legacy: single range string in value field
                      const sheetValues = await readSheetRange(spreadsheetId, sheetBtn.value, accessToken);
                      if (sheetValues && sheetValues.length > 0) {
                        const text = formatSheetData(sheetValues, sheetBtn.text, sheetBtn.value);
                        const msgId = await sendMessage(chatId, text, backKbd, botToken);
                        if (msgId) newIds.push(msgId);
                      } else {
                        const msgId = await sendMessage(
                          chatId,
                          `⚠️ Диапазон <code>${escapeHtml(sheetBtn.value)}</code> пуст или не найден.`,
                          backKbd,
                          botToken,
                        );
                        if (msgId) newIds.push(msgId);
                      }
                    }
                  } else {
                    const msgId = await sendMessage(chatId, botI18n.noGoogleAccess[gsheetLang], undefined, botToken);
                    if (msgId) newIds.push(msgId);
                  }
                } else {
                  const msgId = await sendMessage(chatId, botI18n.googleNotConfigured[gsheetLang], undefined, botToken);
                  if (msgId) newIds.push(msgId);
                }
              }
            }
          } else {
            // Check if callback matches a message template trigger — use bot owner's config
            const userId = botOwnerId;
            if (userId) {
              const { data: cfg } = await supabase
                .from("telegram_bot_config")
                .select("message_templates")
                .eq("user_id", userId)
                .maybeSingle();
              const templates = ((cfg as any)?.message_templates as Array<{
                id: string; title: string; text: string;
                blocks?: Array<{ id: string; type: string; content?: string; label?: string; copyText?: string; btnType?: string }>;
                buttons: Array<{ id: string; label: string; copyText: string; mode?: string }>;
                trigger: string; enabled: boolean;
              }>) ?? [];
              const tmpl = templates.find((t) => t.enabled && t.trigger === callbackData);
              if (tmpl) {
                let msgText = '';
                const keyboardRows: Array<Array<Record<string, unknown>>> = [];

                if (tmpl.blocks && tmpl.blocks.length > 0) {
                  // New block-based format
                  for (const block of tmpl.blocks) {
                    if (block.type === 'text') {
                      if (msgText) msgText += '\n\n';
                      msgText += sanitizeTelegramHtml(block.content ?? '');
                    } else if (block.type === 'button') {
                      const btnType = block.btnType ?? 'copy';
                      const bLabel = block.label ?? '';
                      const bVal = block.copyText ?? '';
                      if (btnType === 'copy' && bVal) {
                        keyboardRows.push([{ text: bLabel, copy_text: { text: bVal } }]);
                      } else if ((btnType === 'url' || btnType === 'message') && bVal) {
                        keyboardRows.push([{ text: bLabel, url: bVal }]);
                      } else if ((btnType === 'mention' || btnType === 'bot' || btnType === 'channel') && bVal) {
                        const username = bVal.replace(/^@/, '');
                        if (username) keyboardRows.push([{ text: bLabel, url: `https://t.me/${username}` }]);
                      } else if (btnType === 'hashtag' && bVal) {
                        const tag = bVal.startsWith('#') ? bVal : `#${bVal}`;
                        keyboardRows.push([{ text: bLabel, switch_inline_query_current_chat: tag }]);
                      }
                    }
                  }
                  if (!msgText) msgText = tmpl.title;
                } else {
                  // Legacy format (text + buttons with mode)
                  const inlineBtns = tmpl.buttons.filter((b) => b.mode === 'inline');
                  const kbBtns = tmpl.buttons.filter((b) => (b.mode ?? 'button') !== 'inline');
                  msgText = tmpl.text || tmpl.title;
                  if (inlineBtns.length > 0) {
                    msgText += '\n\n' + inlineBtns
                      .map((b) => `${escapeHtml(b.label)}\n<code>${escapeHtml(b.copyText)}</code>`)
                      .join('\n\n');
                  }
                  for (const b of kbBtns) {
                    keyboardRows.push([{ text: b.label, copy_text: { text: b.copyText } }]);
                  }
                }

                const msgId = await sendMessage(
                  chatId,
                  msgText,
                  keyboardRows.length > 0 ? { inline_keyboard: keyboardRows } : undefined,
                  botToken,
                );
                if (msgId) newIds.push(msgId);
              } else {
                // Unknown callback — resend menu
              const { keyboard, welcomeMessage } = await buildMainMenuForUser(userId, supabase, userLangCode);
                const msgId = await sendMessage(chatId, welcomeMessage, keyboard, botToken);
                if (msgId) newIds.push(msgId);
              }
            }
          }
        }

        // Persist new message IDs and update last_active_at
        await saveTrackedIds(chatId, existingIds, newIds, supabase);
      }
    } catch (e) {
      console.error("Error:", e);
    }
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response("Telegram Bot Webhook", { headers: corsHeaders });
});

