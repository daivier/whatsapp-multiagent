// Service Worker — recebe push notifications e gere cliques.
// Sem caching de assets para já (PWA installable mas sem offline mode).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'Nova notificação', body: event.data?.text() || '' }; }

  const title = data.title || 'WhatsApp Multi-Atendente';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || `n-${Date.now()}`,
    data: { url: data.url || '/' },
    renotify: false,    // não vibrar de novo se for o mesmo tag (conv-X)
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  // Procurar uma janela já aberta e focá-la (ou navegar nela); caso contrário abre nova
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        try { await client.navigate(url); } catch (_) {}
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
