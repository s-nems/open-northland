import { BrowserWindow, dialog, Menu, shell } from 'electron';
import type { ContentStatus } from './content-state.js';
import { type Locale, messages } from './i18n/index.js';
import { gameUrlForLocale, SETUP_URL } from './protocol.js';
import { isAppUrl, isInGameSession } from './protocol-routing.js';

export function createWindow(initial: ContentStatus, preloadScript: string, locale: Locale): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#1d1a15',
    webPreferences: {
      preload: preloadScript,
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
  void win.loadURL(initial === 'ready' ? gameUrlForLocale(locale) : SETUP_URL);
  return win;
}

async function openSetupPage(win: BrowserWindow): Promise<void> {
  if (isInGameSession(win.webContents.getURL())) {
    const dialogs = messages().dialogs;
    const choice = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [dialogs.leaveGame, dialogs.stay],
      defaultId: 1,
      cancelId: 1,
      message: dialogs.leaveGameMessage,
      detail: dialogs.leaveGameDetail,
    });
    if (choice.response !== 0) return;
  }
  await win.loadURL(SETUP_URL);
}

/**
 * Never auto-hidden on Windows/Linux: this bar is the only home of the reinstall-content and
 * open-data-folder actions, and one hidden behind Alt is undiscoverable.
 */
export function buildAppMenu(win: BrowserWindow, dataRootPath: string): void {
  const menu = messages().menu;
  const gameSubmenu: Electron.MenuItemConstructorOptions[] = [
    { label: menu.reinstall, click: () => void openSetupPage(win) },
    { label: menu.openDataFolder, click: () => void shell.openPath(dataRootPath) },
    { type: 'separator' },
    process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
  ];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
      { label: menu.game, submenu: gameSubmenu },
      { role: 'editMenu' },
      { role: 'viewMenu' },
    ]),
  );
}
