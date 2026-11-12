// The app shell is network-first: users receive a new deployment as soon as
// they are online, while an installed PWA can still start if the phone has a
// slow or unavailable connection. API requests are deliberately never cached.
const APP_SHELL_CACHE = "church-finances-shell-v1";
const APP_SHELL_FILES = ["./", "./manifest.webmanifest", "./church-finances-text.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              (name.startsWith("workbox-") ||
                name.startsWith("church-app-") ||
                name.startsWith("church-finances-shell-")) &&
              name !== APP_SHELL_CACHE,
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(windows.map((client) => client.navigate(client.url)));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Do not intercept Supabase, bank synchronization, or other cross-origin
  // requests. They must always reach the network and retain their CORS headers.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  const isNavigation = request.mode === "navigate";
  const isStaticAsset = /\.(?:css|js|mjs|png|svg|jpg|jpeg|webp|woff2?)$/i.test(url.pathname);
  if (!isNavigation && !isStaticAsset) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (isNavigation) {
          const shell = await caches.match("./");
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Новое уведомление", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Новое уведомление";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || payload.message || "",
      tag: payload.tag || payload.notification_id || undefined,
      icon: payload.icon || "./church-finances-text.png",
      badge: payload.badge || "./church-finances-text.png",
      data: { url: payload.url || "./", notification_id: payload.notification_id || null },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows[0];
      if (client) {
        await client.focus();
        await client.navigate(targetUrl);
        return;
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
