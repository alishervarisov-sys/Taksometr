/* Background Web Push runs even after the admin panel tab has been closed. */
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
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');
const config = JSON.parse(new URL(self.location.href).searchParams.get('config'));
firebase.initializeApp(config);
firebase.messaging().onBackgroundMessage(async payload => {
  if (payload.data?.type !== 'BALANCE_TOP_UP_REQUEST') return;
  const session = await (await caches.open('zaki-admin-push-session')).match('/admin-push-session');
  const current = session ? await session.json() : null;
  if (!current?.adminId || current.adminId !== payload.data.adminId) return;
  return self.registration.showNotification(payload.data.title, {
    body: payload.data.body, tag: `topup-${payload.data.requestId}`,
    data: { url: `/commission?requestId=${encodeURIComponent(payload.data.requestId)}` },
    actions: [{ action: 'review', title: 'Открыть заявку' }],
  });
});
