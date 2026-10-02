/* Background Web Push runs even after the admin panel tab has been closed. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || '/commission';
  const url = new URL(rawUrl, self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const target = windows.find(client => new URL(client.url).origin === url.origin);
    if (target) {
      await target.navigate(url.href);
      return target.focus();
    }
    return self.clients.openWindow(url.href);
  }));
});
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (payload?.data?.type !== 'BALANCE_TOP_UP_REQUEST') return;
  // Keep the worker alive through the cache read and notification display.
  // The Firebase SDK forwards to ANY visible same-origin page instead; a
  // tracking/login tab without onMessage would silently consume that push.
  event.waitUntil((async () => {
    const session = await (await caches.open('zaki-admin-push-session')).match('/admin-push-session');
    const current = session ? await session.json() : null;
    if (!current?.adminId || current.adminId !== payload.data.adminId) return;
    await self.registration.showNotification(payload.data.title, {
      body: payload.data.body, tag: `topup-${payload.data.requestId}`,
      data: { url: `/commission?requestId=${encodeURIComponent(payload.data.requestId)}` },
      actions: [{ action: 'review', title: 'Открыть заявку' }],
    });
    // Preserve the Firebase window SDK's onMessage contract for live refresh.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      client.postMessage({ ...payload, isFirebaseMessaging: true, messageType: 'push-received' });
    }
  })());
});
