import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type InviteRequest = {
  telegramUsername: string;
  name: string;
  department: string;
  role: string;
  hubUrl: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
  const authorization = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Требуется вход в Church Hub" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const body = await req.json() as InviteRequest;
  const username = body.telegramUsername.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username) || !body.name?.trim() || !body.department?.trim() || !body.role?.trim() || !body.hubUrl?.startsWith("http")) {
    return new Response(JSON.stringify({ error: "Проверьте данные приглашения" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: recipient } = await admin.from("telegram_users").select("telegram_chat_id").ilike("telegram_username", username).eq("is_active", true).maybeSingle();
  if (!recipient) return new Response(JSON.stringify({ error: "Пользователь @" + username + " ещё не запустил Telegram-бота Church Hub" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const { data: invitation, error } = await admin.from("church_hub_invitations").insert({ inviter_id: user.id, telegram_username: username, name: body.name.trim(), department: body.department.trim(), role: body.role.trim() }).select("id").single();
  if (error || !invitation) throw error || new Error("Не удалось создать приглашение");

  const link = `${body.hubUrl.replace(/\/$/, "")}?invite=${invitation.id}`;
  const text = `Вас приглашают к совместному служению в Church Hub.\n\nОтдел: ${body.department}\nРоль: ${body.role}\n\nОткройте приглашение и войдите: ${link}`;
  const sent = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: recipient.telegram_chat_id, text, disable_web_page_preview: true }) });
  if (!sent.ok) return new Response(JSON.stringify({ error: "Приглашение сохранено, но Telegram не принял сообщение" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  return new Response(JSON.stringify({ invitationId: invitation.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
