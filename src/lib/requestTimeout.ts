/**
 * Supabase requests can remain pending indefinitely after a mobile network
 * switches between Wi-Fi and cellular data. Never let such a request block
 * the whole application UI.
 */
export const withRequestTimeout = async <T>(
  request: PromiseLike<T>,
  label: string,
  timeoutMs = 15_000,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}: превышено время ожидания сети`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};
