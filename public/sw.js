// Replaces the legacy Workbox worker which could serve an outdated app shell.
// Keep this worker deliberately small: it clears only static cache storage and
// continues to support the push notifications used by the application.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("workbox-") || name.startsWith("church-app-"))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(windows.map((client) => client.navigate(client.url)));
    })(),
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
