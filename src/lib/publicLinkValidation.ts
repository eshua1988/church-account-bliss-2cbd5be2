/**
 * Public links must not inherit an authenticated PWA session. A stale JWT on
 * the shared application client can be rejected by an Edge gateway before a
 * public function is able to return its CORS headers.
 */
export const validatePublicLinkToken = async (token: string) => {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-payout-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ token }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Не удалось проверить ссылку (HTTP ${response.status})`);
  }
  return data;
};
