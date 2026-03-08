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

// ----- Telegram helpers -----

async function sendMessage(chatId: number, text: string, replyMarkup?: object, token?: string) {
  const botToken = token || TELEGRAM_BOT_TOKEN;
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

// ----- Main menu -----

function getMainMenu() {
  return {
    inline_keyboard: [
      [{ text: "🔗 Ссылка ордера расходов", callback_data: "get_links" }],
    ],
  };
}

// ----- Business logic -----

async function handleGetLinks(chatId: number, supabase: ReturnType<typeof createClient>, botToken: string) {
  const { data: telegramUser } = await supabase
    .from("telegram_users")
    .select("user_id")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (!(telegramUser as { user_id: string } | null)?.user_id) {
    await sendMessage(chatId, "❌ Ваш аккаунт не привязан к приложению.\n\nОбратитесь к администратору для привязки.", getMainMenu(), botToken);
    return;
  }

  const userId = (telegramUser as { user_id: string }).user_id;

  const { data: links } = await supabase
    .from("shared_payout_links")
    .select("id, token, name, link_type")
    .eq("owner_user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (!links || links.length === 0) {
    await sendMessage(chatId, "❌ У вас нет активных ссылок для ордеров расходов.\n\nСоздайте ссылку в приложении в разделе «Расходы».", getMainMenu(), botToken);
    return;
  }

  let text = "🔗 <b>Ссылки для ордеров расходов:</b>\n\n";
  const buttons: Array<Array<{ text: string; url: string }>> = [];

  for (const link of links as Array<{ id: string; token: string; name: string | null; link_type: string }>) {
    const url = `${APP_URL}/payout/${link.token}`;
    const typeLabel = link.link_type === "stepwise" ? "📋 Пошаговый" : "📄 Стандартный";
    const name = link.name || "Без названия";
    text += `<b>${name}</b> (${typeLabel})\n<code>${url}</code>\n\n`;
    buttons.push([{ text: `🌐 Открыть: ${name}`, url }]);
  }

  text += "💡 <i>Нажмите и удержите ссылку для копирования</i>";
  await sendMessage(chatId, text, { inline_keyboard: buttons }, botToken);
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

  // Handle Telegram updates (webhook)
  if (req.method === "POST") {
    try {
      const update = await req.json();
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Regular message
      if (update.message?.chat?.type === "private") {
        const chatId = update.message.chat.id as number;
        const botToken = await getBotToken(chatId, supabase);
        await sendMessage(chatId, "👋 Выберите действие:", getMainMenu(), botToken);
      }

      // Inline button press
      if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id as number;
        const botToken = await getBotToken(chatId, supabase);
        await answerCallbackQuery(query.id, botToken);

        if (query.data === "get_links") {
          await handleGetLinks(chatId, supabase, botToken);
        }
      }
    } catch (e) {
      console.error("Error:", e);
    }
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response("Telegram Bot Webhook", { headers: corsHeaders });
});
