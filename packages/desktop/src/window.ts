import { BrowserWindow } from 'electron';
import { GAME_URL } from './protocol.js';
import { isAppUrl } from './protocol-routing.js';

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#1d1a15',
    webPreferences: {
      // The session advances on animation frames even while the game is minimized.
      backgroundThrottling: false,
      // Electron 43 defaults, pinned so a future option edit can't silently regress them.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (!isAppUrl(target)) event.preventDefault();
  });
  void win.loadURL(GAME_URL);
  return win;
}
