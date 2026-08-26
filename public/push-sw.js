self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {
      title: 'Новое уведомление',
      body: event.data ? event.data.text() : '',
    };
  }

  const title = payload.title || 'Новое уведомление';
  const options = {
    body: payload.body || payload.message || '',
    tag: payload.tag || payload.notification_id || undefined,
    icon: payload.icon || './Kosciol.ico.png',
    badge: payload.badge || './Kosciol.ico.png',
    data: {
      url: payload.url || './',
      notification_id: payload.notification_id || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(targetUrl);
        return;
      }
    }

    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});
