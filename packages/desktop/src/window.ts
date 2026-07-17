import { BrowserWindow, dialog, Menu, shell } from 'electron';
import type { ContentStatus } from './content-state.js';
import { APP_ORIGIN_PREFIX, GAME_URL, SETUP_URL } from './protocol.js';

/**
 * The shell's single window and its native menu. The menu owns the shell-level actions (reinstall
 * content, open the data folder) that the web app must not know about, keeping `packages/app`
 * byte-identical to the browser build.
 */

/** Open the window on the game when the content is ready, on the setup page otherwise. */
export function createWindow(initial: ContentStatus, preloadScript: string): BrowserWindow {
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
  // The window renders only the shell's own app:// pages — no popups, no navigation elsewhere.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(APP_ORIGIN_PREFIX)) event.preventDefault();
  });
  void win.loadURL(initial === 'ready' ? GAME_URL : SETUP_URL);
  return win;
}

/** Swap to the setup page; a running game session (there is no saving yet) needs a confirmation. */
async function openSetupPage(win: BrowserWindow): Promise<void> {
  if (win.webContents.getURL() === GAME_URL) {
    const choice = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Leave game', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      message: 'Leave the running game?',
      detail: 'There is no saving yet — the current session will be lost.',
    });
    if (choice.response !== 0) return;
  }
  await win.loadURL(SETUP_URL);
}

/**
 * Builds the shell's native menu. Never auto-hidden on Windows/Linux: this bar is the only home of
 * the reinstall-content and open-data-folder actions, and one hidden behind Alt is undiscoverable.
 */
export function buildAppMenu(win: BrowserWindow, dataRootPath: string): void {
  const gameSubmenu: Electron.MenuItemConstructorOptions[] = [
    // The setup page reads the current content status and offers Regenerate / Play accordingly.
    { label: 'Reinstall game content…', click: () => void openSetupPage(win) },
    { label: 'Open data folder', click: () => void shell.openPath(dataRootPath) },
    { type: 'separator' },
    process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
  ];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
      { label: 'Game', submenu: gameSubmenu },
      { role: 'editMenu' },
      { role: 'viewMenu' },
    ]),
  );
}
