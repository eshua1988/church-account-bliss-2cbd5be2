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
    .select("welcome_message, extra_buttons, show_payout_links")
    .eq("user_id", userId)
    .maybeSingle();

  const welcomeMessage = (config as any)?.welcome_message ?? "👋 Выберите действие:";
  const showPayoutLinks = (config as any)?.show_payout_links !== false;
  const extraButtons =
    ((config as any)?.extra_buttons as Array<{ text: string; type: string; value: string }>) ?? [];

  const buttons: Array<Array<Record<string, unknown>>> = [];

  // Payout link buttons
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

  // Custom extra buttons
  for (const btn of extraButtons) {
    if (btn.type === "copy") {
      buttons.push([{ text: btn.text, copy_text: { text: btn.value } }]);
    } else if (btn.type === "url") {
      buttons.push([{ text: btn.text, url: btn.value }]);
    } else if (btn.type === "callback") {
      buttons.push([{ text: btn.text, callback_data: btn.value }]);
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
          if (update.callback_query.data === "get_links") {
            const msgId = await handleGetLinks(chatId, supabase, botToken);
            if (msgId) newIds.push(msgId);
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

