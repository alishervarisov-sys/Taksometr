const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WEB_HOST = 'zakitaksometr.web.app';
const IS_SMOKE_TEST = process.argv.includes('--smoke-test');
let mainWindow;

function webRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(__dirname, '..', 'firebase', 'hosting');
}

function localFileFor(requestUrl) {
  const root = webRoot();
  const url = new URL(requestUrl);
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(root, candidate);

  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;

  // React BrowserRouter paths (for example /deliveries) are screens, not files.
  // Serving index.html here keeps reload and direct navigation working offline.
  return path.join(root, 'index.html');
}

async function registerBundledAdminPanel() {
  await protocol.handle('https', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== WEB_HOST) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const file = localFileFor(request.url);
    if (!file || !fs.existsSync(file)) {
      return new Response('Bundled admin panel not found', { status: 404 });
    }

    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  if (!fs.existsSync(path.join(webRoot(), 'index.html'))) {
    throw new Error('Bundled admin panel index.html is missing');
  }

  mainWindow = new BrowserWindow({
    title: 'ZaKi Admin — macOS',
    width: 1500,
    height: 900,
    minWidth: 1050,
    minHeight: 650,
    backgroundColor: '#f3f6f4',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!IS_SMOKE_TEST) mainWindow.show();
  });
  mainWindow.webContents.once('did-finish-load', () => {
    if (IS_SMOKE_TEST) app.exit(0);
  });
  mainWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
    if (!IS_SMOKE_TEST) return;
    console.error(`Smoke test failed: ${errorCode} ${errorDescription}`);
    app.exit(2);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`https://${WEB_HOST}/`)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const destination = new URL(url);
    if (destination.hostname === WEB_HOST) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  mainWindow.loadURL(`https://${WEB_HOST}/index.html`);
  mainWindow.on('closed', () => { mainWindow = undefined; });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await registerBundledAdminPanel();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    console.error(error);
    app.exit(2);
  });

  app.on('window-all-closed', () => app.quit());
}
