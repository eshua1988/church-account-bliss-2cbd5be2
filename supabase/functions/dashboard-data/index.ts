import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-user-token, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });

  try {
    const body = await request.json();
    const token = body?.access_token || request.headers.get("x-user-token");
    if (!token || typeof token !== "string") return reply(401, { error: "Требуется авторизация" });

    const url = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!url || !serviceKey) return reply(500, { error: "Сервер не настроен" });

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return reply(401, { error: "Недействительная авторизация" });

    const userId = auth.user.id;
    const loadAll = Boolean(body?.all_transactions);
    const offset = Math.max(0, Number(body?.offset) || 0);
    let transactionQuery = admin
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (!loadAll) transactionQuery = transactionQuery.range(offset, offset + 99);

    const [transactionsResult, totalsResult, categoriesResult] = await Promise.all([
      transactionQuery,
      admin.from("transactions").select("currency, type, amount").eq("user_id", userId),
      admin.from("categories").select("id, user_id, name, type, sort_order, created_at").eq("user_id", userId).order("sort_order", { ascending: true }),
    ]);
    if (transactionsResult.error) throw transactionsResult.error;
    if (totalsResult.error) throw totalsResult.error;
    if (categoriesResult.error) throw categoriesResult.error;

    const totals = new Map<string, { currency: string; income: number; expense: number; balance: number; transaction_count: number }>();
    for (const row of totalsResult.data || []) {
      const currency = String(row.currency || "PLN");
      const current = totals.get(currency) || { currency, income: 0, expense: 0, balance: 0, transaction_count: 0 };
      const amount = Number(row.amount) || 0;
      if (row.type === "income") current.income += amount;
      else current.expense += amount;
      current.balance = current.income - current.expense;
      current.transaction_count += 1;
      totals.set(currency, current);
    }

    return reply(200, {
      transactions: transactionsResult.data || [],
      currency_totals: [...totals.values()],
      categories: categoriesResult.data || [],
    });
  } catch (error) {
    console.error("dashboard-data failed", error);
    return reply(500, { error: error instanceof Error ? error.message : "Не удалось загрузить данные" });
  }
});
