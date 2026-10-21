const { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const data = require('./src/data');

const DEFAULTS = {
  hotkeyToggle: 'Alt+Shift+D',
  hotkeyClickThrough: 'Alt+Shift+C',
  opacity: 0.94,
  stratzToken: '',
  bracket: 'ALL',
  bounds: null,
};

let win = null;
let settings = { ...DEFAULTS };
let clickThrough = false;
let refreshing = null;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1180, area.width);
  const height = Math.min(740, area.height);
  const bounds = settings.bounds || {
    width,
    height,
    x: area.x + area.width - width - 20,
    y: area.y + Math.round((area.height - height) / 2),
  };

  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 560,
    frame: false,
    backgroundColor: '#0f1218',
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    title: 'Dota 2 Draft Helper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 'screen-saver' keeps the window above a borderless-fullscreen game.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setOpacity(settings.opacity);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  let saveTimer = null;
  const rememberBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      settings.bounds = win.getBounds();
      saveSettings();
    }, 500);
  };
  win.on('move', rememberBounds);
  win.on('resize', rememberBounds);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) {
    win.hide();
  } else {
    win.show();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.focus();
  }
}

function setClickThrough(on) {
  clickThrough = on;
  win.setIgnoreMouseEvents(on, { forward: true });
  win.setOpacity(on ? Math.min(settings.opacity, 0.6) : settings.opacity);
  win.webContents.send('click-through', on);
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  if (!globalShortcut.register(settings.hotkeyToggle, toggleWindow)) failed.push(settings.hotkeyToggle);
  if (!globalShortcut.register(settings.hotkeyClickThrough, () => setClickThrough(!clickThrough)))
    failed.push(settings.hotkeyClickThrough);
  return failed;
}

function startRefresh() {
  if (refreshing) return refreshing;
  const dir = app.getPath('userData');
  refreshing = data
    .refresh({
      dir,
      bracket: settings.bracket,
      token: settings.stratzToken,
      onProgress: (msg) => win && win.webContents.send('data:progress', msg),
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

ipcMain.handle('settings:get', () => ({ ...settings, brackets: data.BRACKETS }));
ipcMain.handle('settings:set', (_e, patch) => {
  const allowed = ['hotkeyToggle', 'hotkeyClickThrough', 'opacity', 'stratzToken', 'bracket'];
  for (const k of allowed) if (k in patch) settings[k] = patch[k];
  saveSettings();
  win.setOpacity(settings.opacity);
  return { failedHotkeys: registerHotkeys() };
});
ipcMain.handle('data:cached', () => {
  const cached = data.readCache(app.getPath('userData'), settings.bracket);
  return { dataset: cached, stale: data.isStale(cached), heroes: data.bundledHeroes };
});
ipcMain.handle('data:refresh', async () => {
  try {
    return { dataset: await startRefresh() };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.on('win:hide', () => win.hide());
ipcMain.on('win:minimize', () => win.minimize());
ipcMain.on('win:quit', () => app.quit());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => toggleWindow());
  app.whenReady().then(() => {
    loadSettings();
    createWindow();
    registerHotkeys();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
