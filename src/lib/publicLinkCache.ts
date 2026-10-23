type CachedValue<T> = { expiresAt: number; value: T };

// Public links are frequently opened several times on the same phone. Keep a
// short, device-local copy of their read-only payloads. This avoids repeated
// API downloads while still refreshing quickly after a link is changed.
export const readPublicLinkCache = <T>(key: string): T | null => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedValue<T>;
    if (!cached || cached.expiresAt <= Date.now()) {
      sessionStorage.removeItem(key);
      return null;
    }
    return cached.value;
  } catch {
    return null;
  }
};

export const writePublicLinkCache = <T>(key: string, value: T, maxAgeMs: number) => {
  try {
    const cached: CachedValue<T> = { value, expiresAt: Date.now() + maxAgeMs };
    sessionStorage.setItem(key, JSON.stringify(cached));
  } catch {
    // Caching is an optimisation. The public link must still work if storage
    // is disabled or full.
  }
};

export const clearPublicLinkCache = (prefix: string) => {
  try {
    Object.keys(sessionStorage)
      .filter(key => key.startsWith(prefix))
      .forEach(key => sessionStorage.removeItem(key));
  } catch {
    // Ignore unavailable browser storage.
  }
};
