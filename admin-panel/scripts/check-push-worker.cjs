const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/firebase-messaging-sw.js'), 'utf8');
const payload = { data: { type: 'BALANCE_TOP_UP_REQUEST', adminId: 'admin', requestId: 'request-1', title: 'Пополнение', body: 'Заявка' } };
let session = { adminId: 'admin' };
let windows = [];
const shown = [], forwarded = [], opened = [];
function startWorker() {
  const listeners = {};
  vm.runInNewContext(source, {
    URL,
    caches: { open: async () => ({ match: async () => session ? { json: async () => session } : null }) },
    self: {
      location: { origin: 'https://panel.test' },
      addEventListener: (type, handler) => { listeners[type] = handler; },
      skipWaiting: async () => {},
      registration: { showNotification: async (...args) => shown.push(args) },
      clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async url => opened.push(url) },
    },
  });
  return listeners;
}
async function push(listeners, message = payload) {
  let lifetime;
  listeners.push({ data: { json: () => message }, waitUntil: promise => { lifetime = promise; } });
  await lifetime;
}
(async () => {
  // No app globals or windows survive a worker restart; only browser storage does.
  await push(startWorker());
  assert.equal(shown.length, 1, 'A restarted worker with no tabs must display push');
  assert.equal(shown[0][1].data.url, '/commission?requestId=request-1');
  windows = [{ url: 'https://panel.test/login', visibilityState: 'visible', postMessage: message => forwarded.push(message) }];
  await push(startWorker());
  assert.equal(shown.length, 2, 'An unrelated visible page must not swallow push');
  assert.equal(forwarded[0].messageType, 'push-received');
  assert.equal(forwarded[0].isFirebaseMessaging, true);
  session = { adminId: 'different-admin' };
  await push(startWorker());
  session = { adminId: null };
  await push(startWorker());
  session = null;
  await push(startWorker());
  assert.equal(shown.length, 2, 'Logout, removed storage and account switches must suppress push');
  await push(startWorker(), { data: { type: 'OTHER' } });
  assert.equal(shown.length, 2);
  const listener = startWorker();
  listener.push({ data: { json: () => { throw Error('Malformed payload'); } } });
  windows = [];
  let clickLifetime;
  listener.notificationclick({ notification: { close() {}, data: { url: '/commission?requestId=request-1' } }, waitUntil: promise => { clickLifetime = promise; } });
  await clickLifetime;
  assert.equal(opened[0], 'https://panel.test/commission?requestId=request-1');
  listener.notificationclick({ notification: { close() {}, data: { url: 'https://other.test' } } });
  assert.equal(opened.length, 1, 'Notification links cannot leave the panel origin');
  console.log('Web Push checks passed: worker restart, closed tabs, unrelated visible page, account isolation, malformed payload and click navigation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
