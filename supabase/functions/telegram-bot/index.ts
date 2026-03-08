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

async function sendMessage(chatId: number, text: string, replyMarkup?: object) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function answerCallbackQuery(callbackQueryId: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

function getMainMenu() {
  return {
    inline_keyboard: [
      [{ text: "🔗 Ссылка ордера расходов", callback_data: "get_links" }],
    ],
  };
}

async function handleGetLinks(chatId: number, supabase: ReturnType<typeof createClient>) {
  // Find the user linked to this Telegram chat
  const { data: telegramUser } = await supabase
    .from("telegram_users")
    .select("user_id")
    .eq("telegram_chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (!telegramUser?.user_id) {
    await sendMessage(
      chatId,
      "❌ Ваш аккаунт не привязан к приложению.\n\nОбратитесь к администратору для привязки.",
      getMainMenu()
    );
    return;
  }

  // Get active payout links for this user
  const { data: links } = await supabase
    .from("shared_payout_links")
    .select("id, token, name, link_type")
    .eq("owner_user_id", telegramUser.user_id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (!links || links.length === 0) {
    await sendMessage(
      chatId,
      "❌ У вас нет активных ссылок для ордеров расходов.\n\nСоздайте ссылку в приложении в разделе «Расходы».",
      getMainMenu()
    );
    return;
  }

  // Build message with each link as copyable text + inline open button
  let text = "🔗 <b>Ссылки для ордеров расходов:</b>\n\n";
  const buttons: Array<Array<{ text: string; url: string }>> = [];

  for (const link of links) {
    const url = `${APP_URL}/payout/${link.token}`;
    const typeLabel = link.link_type === "stepwise" ? "📋 Пошаговый" : "📄 Стандартный";
    const name = link.name || "Без названия";

    text += `<b>${name}</b> (${typeLabel})\n`;
    text += `<code>${url}</code>\n\n`;

    buttons.push([{ text: `🌐 Открыть: ${name}`, url }]);
  }

  text += "💡 <i>Нажмите и удержите ссылку для копирования</i>";

  await sendMessage(chatId, text, { inline_keyboard: buttons });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "POST") {
    try {
      const update = await req.json();
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Handle regular messages
      if (update.message?.chat?.type === "private") {
        const chatId = update.message.chat.id as number;
        await sendMessage(chatId, "👋 Выберите действие:", getMainMenu());
      }

      // Handle inline button presses
      if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message.chat.id as number;
        await answerCallbackQuery(query.id);

        if (query.data === "get_links") {
          await handleGetLinks(chatId, supabase);
        }
      }
    } catch (e) {
      console.error("Error:", e);
    }
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response("Telegram Bot Webhook", { headers: corsHeaders });
});
