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

interface CheckPublicPendingPayoutsInput {
  token: string;
  submitterName: string;
  transactionId?: string;
  amount?: number;
  date?: string;
}

// The pending-document list is also part of the public payout flow.  Use the
// same anonymous request as token validation so an old signed-in PWA session
// cannot make the browser send an unrelated Authorization header.
export const checkPublicPendingPayouts = async <T = unknown>(
  payload: CheckPublicPendingPayoutsInput,
): Promise<T> => {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-pending-payouts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Не удалось загрузить документы (HTTP ${response.status})`);
  }
  return data as T;
};

// Creating an order is a public-link action as well.  Do not use the shared
// Supabase client here: an obsolete logged-in session may add Authorization
// and make the Edge gateway reject the request before it sends CORS headers.
export const submitPublicPayout = async <T = unknown>(
  payload: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-public-payout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Не удалось отправить ордер (HTTP ${response.status})`);
  }
  return data as T;
};

export const submitPublicDeposit = async <T = unknown>(
  payload: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-public-deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Не удалось отправить приходный ордер (HTTP ${response.status})`);
  }
  return data as T;
};

/**
 * Executes a public Edge Function without carrying over an authenticated
 * application/PWA session. Public functions still validate their link token
 * and any action-specific permissions on the server.
 */
export const invokePublicFunction = async <T = unknown>(
  functionName: string,
  options: { body: unknown },
): Promise<{ data: T | null; error: Error | null }> => {
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(options.body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { data: null, error: new Error(data?.error || `Ошибка публичного запроса (HTTP ${response.status})`) };
    }
    return { data: data as T, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error('Не удалось выполнить публичный запрос') };
  }
};
