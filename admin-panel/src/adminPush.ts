import { initializeApp } from 'firebase/app';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// The existing database client uses an Android app ID. Messaging needs the
// registered zakitaksometr WEB app; retrieved by its exact Firebase app ID.
const config = {
  projectId: 'auva-70253', appId: '1:286896671827:web:e3a11735f9298bf3dc0aa6',
  apiKey: 'AIzaSyAZOxDgKqINBfmU4SeojMEOsZu8WYC0HOw', authDomain: 'auva-70253.firebaseapp.com',
  messagingSenderId: '286896671827', storageBucket: 'auva-70253.firebasestorage.app',
};
const pushApp = initializeApp(config, 'admin-web-push');
const SESSION_CACHE = 'zaki-admin-push-session';
type DesktopWindow = Window & { zakiDesktopNotifications?: boolean; chrome?: { webview?: { postMessage: (message: unknown) => void } } };
export const usesWindowsNotifications = () => (window as DesktopWindow).zakiDesktopNotifications === true;
export function notifyWindowsLogout() {
  if (usesWindowsNotifications()) (window as DesktopWindow).chrome?.webview?.postMessage({ type: 'ZAKI_LOGOUT' });
}

async function setPushSession(adminId: string | null) {
  if (!('caches' in window)) return;
  const cache = await caches.open(SESSION_CACHE);
  await cache.put('/admin-push-session', new Response(JSON.stringify({ adminId })));
}

export async function enableAdminWebPush(adminId: string, vapidKey: string, requestPermission = true) {
  if (!await isSupported() || !window.isSecureContext) throw new Error('Этот браузер не поддерживает Web Push. Откройте панель по HTTPS.');
  if (!vapidKey) throw new Error('Сначала подключите публичный ключ Web Push из Firebase.');
  const permission = requestPermission ? await Notification.requestPermission() : Notification.permission;
  if (permission !== 'granted') throw new Error('Разрешите уведомления для этого сайта в настройках браузера.');
  const registration = await navigator.serviceWorker.register(
    '/firebase-messaging-sw.js?v=2',
    { scope: '/firebase-cloud-messaging-push-scope', updateViaCache: 'none' },
  );
  if (!registration.active) {
    const worker = registration.installing || registration.waiting;
    if (worker) await new Promise<void>((resolve, reject) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') resolve();
        if (worker.state === 'redundant') reject(new Error('Не удалось запустить обработчик push.'));
      });
      if (worker.state === 'activated') resolve();
    });
  }
  const token = await getToken(getMessaging(pushApp), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Не удалось получить push-токен браузера.');
  if (localStorage.getItem('adminId') !== adminId) return;
  await httpsCallable(functions, 'registerAdminWebPush')({ adminId, token });
  if (localStorage.getItem('adminId') !== adminId) {
    await httpsCallable(functions, 'registerAdminWebPush')({ adminId, token, enabled: false });
    return;
  }
  localStorage.setItem('adminPushToken', token);
  await setPushSession(adminId);
}

export async function disableAdminWebPush(adminId: string) {
  if (usesWindowsNotifications()) return;
  // Suppress background notifications locally even if logout is offline.
  await setPushSession(null);
  const token = localStorage.getItem('adminPushToken');
  localStorage.removeItem('adminPushToken');
  const cleanup = Promise.allSettled([
    token ? httpsCallable(functions, 'registerAdminWebPush')({ adminId, token, enabled: false }) : Promise.resolve(),
    isSupported().then(supported => supported ? deleteToken(getMessaging(pushApp)) : false),
  ]);
  await Promise.race([cleanup, new Promise(resolve => window.setTimeout(resolve, 2000))]);
}

export async function listenToAdminPush(adminId: string, refresh: () => void) {
  if (usesWindowsNotifications()) return () => {};
  if (!await isSupported()) return () => {};
  return onMessage(getMessaging(pushApp), async payload => {
    if (payload.data?.adminId !== adminId || payload.data?.type !== 'BALANCE_TOP_UP_REQUEST') return;
    refresh();
  });
}
