const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');

// ─── Hot Reload (watches renderer/ folder) ──────────────────────
try {
  require('electron-reload')(__dirname, {
    electron: require(`${__dirname}/node_modules/.bin/electron`),
    watched: [
      `${__dirname}/renderer/index.html`,
      `${__dirname}/renderer/island.css`,
      `${__dirname}/renderer/island.js`,
    ],
    hardReset: false, // Only reload renderer, not full app restart
  });
} catch (e) { /* ignore in production */ }
const fs = require('fs');
const path = require('path');
const si = require('systeminformation');
const mediaService = require('./services/media');
const batteryService = require('./services/battery');
const networkService = require('./services/network');

let islandWindow;
let settingsWindow;
let tray;

// Default appearance settings
const DEFAULT_SETTINGS = {
  opacity: 65, blur: 24, saturation: 180, brightness: 88,
  tint: '10,10,12', tintOpacity: 0,
  border: 12, shadow: 50, glow: 12, collapse: 1.5,
};

// Settings storage file path in user data folder
const SETTINGS_FILE = path.join(app.getPath('userData'), 'island-settings.json');

function loadSavedSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return Object.assign({}, DEFAULT_SETTINGS, parsed);
    }
  } catch (err) {
    console.error('[Settings] Failed to load saved settings:', err);
  }
  return Object.assign({}, DEFAULT_SETTINGS);
}

function saveSettingsToFile(settings) {
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[Settings] Failed to save settings to disk:', err);
    return false;
  }
}

// Persisted appearance settings
let currentSettings = loadSavedSettings();

// Fixed canvas dimensions to accommodate all island activities with zero OS window resizing
const ISLAND_WINDOW_W = 440;
const ISLAND_WINDOW_H = 200;
const ISLAND_TOP_OFFSET = 8;

// Active island pill geometry (centered horizontally in window, starts at y = ISLAND_TOP_OFFSET)
let activeIslandGeometry = { width: 126, height: 37, isExpanded: false };
let isCursorOverIsland = false;
let cursorInterval = null;

let winX = 0;
const winY = ISLAND_TOP_OFFSET;
const winW = ISLAND_WINDOW_W;
const winH = ISLAND_WINDOW_H;

function startCursorTracker() {
  if (cursorInterval) clearInterval(cursorInterval);
  cursorInterval = setInterval(() => {
    if (!islandWindow || islandWindow.isDestroyed()) return;

    // Ultra-lightweight: only poll OS cursor when island is hovered or expanded!
    if (!isCursorOverIsland && !activeIslandGeometry.isExpanded) return;

    const cursor = screen.getCursorScreenPoint();

    // Island pill is horizontally centered in the window
    const islandW = activeIslandGeometry.width || 126;
    const islandH = activeIslandGeometry.height || 37;
    const islandLeft = winX + Math.round((winW - islandW) / 2);
    const islandRight = islandLeft + islandW;
    const islandTop = winY;
    const islandBottom = islandTop + islandH;

    // 8px horizontal, 8px bottom safety margin for seamless cursor interaction
    const over = (
      cursor.x >= islandLeft - 6 &&
      cursor.x <= islandRight + 6 &&
      cursor.y >= islandTop - 4 &&
      cursor.y <= islandBottom + 8
    );

    if (over !== isCursorOverIsland) {
      isCursorOverIsland = over;
      if (over) {
        islandWindow.setIgnoreMouseEvents(false);
        islandWindow.webContents.send('cursor-enter');
      } else {
        islandWindow.setIgnoreMouseEvents(true, { forward: true });
        islandWindow.webContents.send('cursor-leave');
      }
    }
  }, 100);
}

function createIslandWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;
  winX = Math.round(screenW / 2 - ISLAND_WINDOW_W / 2);
  const x = winX;

  islandWindow = new BrowserWindow({
    width: ISLAND_WINDOW_W,
    height: ISLAND_WINDOW_H,
    x: x,
    y: ISLAND_TOP_OFFSET,
    frame: false,
    transparent: true,
    backgroundColor: null, // Fully transparent window — required for backdrop-filter glassmorphism
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    resizable: false,
    movable: false,
    hasShadow: false,
    focusable: false,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Enable click-through forwarding on transparent canvas by default
  islandWindow.setIgnoreMouseEvents(true, { forward: true });

  // Load island renderer
  islandWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  islandWindow.webContents.on('did-finish-load', () => {
    islandWindow.webContents.send('apply-settings', currentSettings);
  });

  // Keep it always on top at the highest level
  islandWindow.setAlwaysOnTop(true, 'screen-saver');
  islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  islandWindow.moveTop();

  // Start OS-level global cursor watcher
  startCursorTracker();

  // Occasional safeguard: keep always-on-top without DWM stutter
  const topInterval = setInterval(() => {
    if (!islandWindow || islandWindow.isDestroyed()) {
      clearInterval(topInterval);
      return;
    }
    if (islandWindow.isVisible()) {
      islandWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 5000);

  // Open DevTools in dev mode
  if (process.argv.includes('--dev')) {
    islandWindow.webContents.openDevTools({ mode: 'detach' });
  }

  islandWindow.on('closed', () => {
    if (cursorInterval) { clearInterval(cursorInterval); cursorInterval = null; }
    clearInterval(topInterval);
    islandWindow = null;
  });
}

function createSettingsWindow() {
  // If already open, focus it
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  settingsWindow = new BrowserWindow({
    width: 340,
    height: 640,
    x: Math.round(sw / 2 - 170),
    y: Math.round(sh / 2 - 320),
    frame: false,
    transparent: true,
    backgroundColor: null,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.setAlwaysOnTop(true, 'pop-up-menu');

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createTray() {
  // Load tray icon from assets — white circle pill, visible in Windows system tray
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  } catch (e) {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Dynamic Island — Right-click for options');

  const autostart = require('./scripts/autostart');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide',
      click: () => {
        if (islandWindow) {
          if (islandWindow.isVisible()) {
            islandWindow.hide();
          } else {
            islandWindow.show();
            islandWindow.setAlwaysOnTop(true, 'screen-saver');
            islandWindow.moveTop();
          }
        }
      },
    },
    {
      label: 'Appearance Settings...',
      click: () => createSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: 'Start on Windows Boot',
      type: 'checkbox',
      checked: autostart.isEnabled(),
      click: (menuItem) => {
        if (menuItem.checked) {
          autostart.enable();
        } else {
          autostart.disable();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(contextMenu);
}

// ─── IPC Handlers ──────────────────────────────────────────────────────────

// Renderer resize no-op (canvas is stable to eliminate DWM resize flicker)
ipcMain.on('resize-island', () => {});

// Active island geometry reported from renderer
ipcMain.on('island-bounds-update', (event, bounds) => {
  if (bounds && bounds.width && bounds.height) {
    activeIslandGeometry = bounds;
  }
});

// ─── Settings IPC ─────────────────────────────────────────────────────────

// Settings window: close
ipcMain.on('settings-close', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

// Settings window: user changed a setting → push to island immediately
ipcMain.on('settings-apply', (event, settings) => {
  Object.assign(currentSettings, settings);
  saveSettingsToFile(currentSettings);
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.webContents.send('apply-settings', currentSettings);
  }
});

// Settings window: explicit save button
ipcMain.handle('settings-save', (event, settings) => {
  if (settings) Object.assign(currentSettings, settings);
  const ok = saveSettingsToFile(currentSettings);
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.webContents.send('apply-settings', currentSettings);
  }
  return { success: ok, settings: currentSettings };
});

// Settings window: reset button
ipcMain.handle('settings-reset', () => {
  currentSettings = Object.assign({}, DEFAULT_SETTINGS);
  const ok = saveSettingsToFile(currentSettings);
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.webContents.send('apply-settings', currentSettings);
  }
  return { success: ok, settings: currentSettings };
});

// Settings window: get current saved settings (used on open)
ipcMain.handle('settings-get', () => currentSettings);

const mediaController = require('./services/mediaController');

// System media playback control (Play/Pause, Next, Prev, 10s Seek Forward/Rewind)
ipcMain.on('media-control', (event, action) => {
  mediaController.send(action);
});

const { shell } = require('electron');
const { exec } = require('child_process');

// Quick utility actions launcher
ipcMain.on('quick-action', (event, action) => {
  if (action === 'youtube') {
    shell.openExternal('https://youtube.com');
  } else if (action === 'calc') {
    exec('calc.exe');
  } else if (action === 'screenshot') {
    exec('explorer.exe ms-screenclip:');
  } else if (action === 'files') {
    exec('explorer.exe');
  } else if (action === 'lock') {
    exec('rundll32.exe user32.dll,LockWorkStation');
  } else if (action === 'sleep') {
    exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
  } else if (action === 'shutdown') {
    exec('shutdown /s /t 0');
  } else if (action === 'restart') {
    exec('shutdown /r /t 0');
  }
});

// Renderer asks to enable/disable click-through
let lastIgnoreMouseState = null;
ipcMain.on('set-ignore-mouse', (event, ignore) => {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  if (lastIgnoreMouseState === ignore) return; // Prevent unnecessary Win32 style re-applies
  lastIgnoreMouseState = ignore;

  islandWindow.setIgnoreMouseEvents(ignore, { forward: true });
  // Windows OS fix: toggling WS_EX_TRANSPARENT strips HWND_TOPMOST in Win32 DWM.
  // We re-assert alwaysOnTop immediately so the window never gets pushed behind Chrome/apps.
  islandWindow.setAlwaysOnTop(true, 'screen-saver');
  islandWindow.moveTop();
});

// ─── Start services & push data to renderer ─────────────────────────────────

function startServices() {
  // Media / Now Playing
  mediaService.start((data) => {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('media-update', data);
    }
  });

  // Battery
  batteryService.start((data) => {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('battery-update', data);
    }
  });

  // Network
  networkService.start((data) => {
    if (islandWindow && !islandWindow.isDestroyed()) {
      islandWindow.webContents.send('network-update', data);
    }
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createIslandWindow();
  createTray();
  startServices();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createIslandWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
