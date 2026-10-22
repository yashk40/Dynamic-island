const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('islandBridge', {
  // Resize the Electron window
  resize: (width, height) => ipcRenderer.send('resize-island', { width, height }),

  // Enable / disable click-through
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),

  // Control system media playback
  mediaControl: (action) => ipcRenderer.send('media-control', action),

  // Volume & Sound Output
  toggleMute: () => ipcRenderer.send('volume-toggle'),
  openSoundSettings: () => ipcRenderer.send('open-sound-settings'),

  // System & App Quick Actions
  quickAction: (action) => ipcRenderer.send('quick-action', action),

  // Listen for service updates (clean up previous listeners to prevent leak on reloads)
  onMedia: (cb) => {
    ipcRenderer.removeAllListeners('media-update');
    ipcRenderer.on('media-update', (_, data) => cb(data));
  },
  onBattery: (cb) => {
    ipcRenderer.removeAllListeners('battery-update');
    ipcRenderer.on('battery-update', (_, data) => cb(data));
  },
  onNetwork: (cb) => {
    ipcRenderer.removeAllListeners('network-update');
    ipcRenderer.on('network-update', (_, data) => cb(data));
  },
  onStats: (cb) => {
    ipcRenderer.removeAllListeners('stats-update');
    ipcRenderer.on('stats-update', (_, data) => cb(data));
  },

  // Listen for appearance settings pushed from the settings window
  onSettings: (cb) => {
    ipcRenderer.removeAllListeners('apply-settings');
    ipcRenderer.on('apply-settings', (_, data) => cb(data));
  },

  // Report active island pixel bounds to main process for OS-level cursor tracking
  reportBounds: (bounds) => ipcRenderer.send('island-bounds-update', bounds),

  // OS-level cursor enter/leave notifications
  onCursorEnter: (cb) => {
    ipcRenderer.removeAllListeners('cursor-enter');
    ipcRenderer.on('cursor-enter', () => cb());
  },
  onCursorLeave: (cb) => {
    ipcRenderer.removeAllListeners('cursor-leave');
    ipcRenderer.on('cursor-leave', () => cb());
  },
});

// Settings window bridge (only available in settings.html context)
contextBridge.exposeInMainWorld('settingsBridge', {
  close:         ()  => ipcRenderer.send('settings-close'),
  applySettings: (s) => ipcRenderer.send('settings-apply', s),
  getSettings:   ()  => ipcRenderer.invoke('settings-get'),
  saveSettings:  (s) => ipcRenderer.invoke('settings-save', s),
  resetSettings: ()  => ipcRenderer.invoke('settings-reset'),
});
