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

// ----- Dynamic main menu -----

async function buildMainMenuForUser(
  userId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<{ keyboard: object; welcomeMessage: string }> {
  // Read custom bot config
  const { data: config } = await supabase
    .from("telegram_bot_config")
    .select("welcome_message, extra_buttons, show_payout_links, message_templates, menu_order")
    .eq("user_id", userId)
    .maybeSingle();

  const welcomeMessage = (config as any)?.welcome_message ?? "👋 Выберите действие:";
  const showPayoutLinks = (config as any)?.show_payout_links !== false;
  const extraButtons: Array<{ id: string; text: string; type: string; value: string }> =
    ((config as any)?.extra_buttons) ?? [];
  const messageTemplates: Array<{
    id: string; title: string; text: string; trigger: string; enabled: boolean;
    buttons: Array<{ id: string; label: string; copyText: string }>;
  }> = ((config as any)?.message_templates) ?? [];
  const menuOrder: Array<{ id: string; kind: string }> =
    ((config as any)?.menu_order) ?? [];

  const buttons: Array<Array<Record<string, unknown>>> = [];

  // Payout link buttons (always first — system level)
  if (showPayoutLinks) {
    const { data: links } = await supabase
      .from("shared_payout_links")
      .select("token, name, link_type")
      .eq("owner_user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (links && links.length > 0) {
      (links as Array<{ token: string; name: string | null; link_type: string }>).forEach((link) => {
        const url = `${APP_URL}/payout/${link.token}`;
        buttons.push([{ text: "🔗 Ссылка Ордера расходов - Скопировать", copy_text: { text: url } }]);
      });
    }
  }

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

  for (const entry of orderedIds) {
    try {
      if (entry.kind === "button") {
        const btn = btnMap.get(entry.id);
        if (!btn) continue;
        if (btn.type === "copy" && btn.value) {
          buttons.push([{ text: btn.text, copy_text: { text: btn.value } }]);
        } else if (btn.type === "url" && btn.value) {
          buttons.push([{ text: btn.text, url: btn.value }]);
        } else if (btn.type === "callback" && btn.value) {
          buttons.push([{ text: btn.text, callback_data: btn.value }]);
        } else if (btn.type === "google_sheet") {
          buttons.push([{ text: btn.text, callback_data: `gsheet_${btn.id}` }]);
        } else if (btn.type === "web_app" && btn.value) {
          buttons.push([{ text: btn.text, web_app: { url: btn.value } }]);
        } else if (btn.type === "switch_inline") {
          buttons.push([{ text: btn.text, switch_inline_query: btn.value ?? "" }]);
        } else if (btn.type === "switch_inline_current") {
          buttons.push([{ text: btn.text, switch_inline_query_current_chat: btn.value ?? "" }]);
        } else if (btn.type === "hashtag" && btn.value) {
          const tag = btn.value.startsWith("#") ? btn.value : `#${btn.value}`;
          buttons.push([{ text: btn.text, switch_inline_query_current_chat: tag }]);
        }
      } else if (entry.kind === "template") {
        const tmpl = tmplMap.get(entry.id);
        if (!tmpl) continue;
        buttons.push([{ text: tmpl.title || tmpl.trigger, callback_data: tmpl.trigger }]);
      }
    } catch {
      // Skip malformed entry so it doesn't break the entire keyboard
    }
  }

  if (buttons.length === 0) {
    buttons.push([{ text: "🔗 Ссылка ордера расходов", callback_data: "get_links" }]);
  }

  return { keyboard: { inline_keyboard: buttons }, welcomeMessage };
}

async function buildMainMenu(
  chatId: number,
  supabase: ReturnType<typeof createClient>,
): Promise<{ keyboard: object; welcomeMessage: string }> {
  const { data: telegramUser } = await supabase
    .from("telegram_users")
    .select("user_id")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  const userId = (telegramUser as { user_id: string } | null)?.user_id;
  if (!userId) {
    return {
      keyboard: { inline_keyboard: [[{ text: "🔗 Ссылка ордера расходов", callback_data: "get_links" }]] },
      welcomeMessage: "👋 Выберите действие:",
    };
  }

  return buildMainMenuForUser(userId, supabase);
}

// ----- Business logic (fallback for old callback buttons) -----

async function handleGetLinks(
  chatId: number,
  supabase: ReturnType<typeof createClient>,
  botToken: string,
): Promise<number | null> {
  const { data: telegramUser } = await supabase
    .from("telegram_users")
    .select("user_id")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (!(telegramUser as { user_id: string } | null)?.user_id) {
    const { keyboard, welcomeMessage } = await buildMainMenu(chatId, supabase);
    return sendMessage(
      chatId,
      "❌ Ваш аккаунт не привязан к приложению.\n\nОбратитесь к администратору для привязки.",
      keyboard,
      botToken,
    );
  }

  const { keyboard, welcomeMessage } = await buildMainMenu(chatId, supabase);
  return sendMessage(chatId, welcomeMessage, keyboard, botToken);
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
    const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;
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
      const { bot_token } = await req.json() as { bot_token: string };
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
      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;
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
        const botToken = await getBotToken(chatId, supabase);

        // Clear history if user was inactive for 6+ hours
        const existingIds = await clearStaleHistory(chatId, supabase, botToken);
        const newIds: number[] = [];

        // Regular message → send menu
        if (update.message?.chat?.type === "private") {
          const { keyboard, welcomeMessage } = await buildMainMenu(chatId, supabase);
          const msgId = await sendMessage(chatId, welcomeMessage, keyboard, botToken);
          if (msgId) newIds.push(msgId);
        }

        // Inline button press
        if (update.callback_query) {
          await answerCallbackQuery(update.callback_query.id, botToken);
          const callbackData: string = update.callback_query.data || "";

          if (callbackData === "get_links") {
            const msgId = await handleGetLinks(chatId, supabase, botToken);
            if (msgId) newIds.push(msgId);
          } else if (callbackData.startsWith("gsheet_")) {
            // Google Sheet data button
            const { data: telegramUser2 } = await supabase
              .from("telegram_users")
              .select("user_id")
              .eq("telegram_chat_id", chatId)
              .eq("is_active", true)
              .maybeSingle();
            const userId2 = (telegramUser2 as { user_id: string } | null)?.user_id;
            if (userId2) {
              const btnId = callbackData.slice(7); // strip "gsheet_"
              const { data: cfg2 } = await supabase
                .from("telegram_bot_config")
                .select("extra_buttons")
                .eq("user_id", userId2)
                .maybeSingle();
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
                    const msgId = await sendMessage(chatId, "❌ Не удалось получить доступ к Google Таблице.", undefined, botToken);
                    if (msgId) newIds.push(msgId);
                  }
                } else {
                  const msgId = await sendMessage(chatId, "❌ Google Таблица не настроена в профиле.", undefined, botToken);
                  if (msgId) newIds.push(msgId);
                }
              }
            }
          } else {
            // Check if callback matches a message template trigger
            const { data: telegramUser } = await supabase
              .from("telegram_users")
              .select("user_id")
              .eq("telegram_chat_id", chatId)
              .eq("is_active", true)
              .maybeSingle();
            const userId = (telegramUser as { user_id: string } | null)?.user_id;
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
                      msgText += block.content ?? '';
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
                const { keyboard, welcomeMessage } = await buildMainMenuForUser(userId, supabase);
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

