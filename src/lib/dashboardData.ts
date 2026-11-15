interface LoadOptions {
  allTransactions?: boolean;
  offset?: number;
}

export const loadDashboardData = async (userId: string, accessToken: string, options: LoadOptions = {}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/banking-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        user_id: userId,
        access_token: accessToken,
        action: 'dashboard',
        all_transactions: options.allTransactions === true,
        offset: options.offset || 0,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `Загрузка данных: HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Загрузка данных: превышено время ожидания сети');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};
