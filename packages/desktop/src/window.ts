import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  screen,
} from 'electron';
import {
  FULLSCREEN_CHANGED_CHANNEL,
  IS_FULLSCREEN_CHANNEL,
  SET_FULLSCREEN_CHANNEL,
} from './fullscreen-channels.js';
import { leavePromptFor } from './leave-prompt.js';
import { GAME_URL } from './protocol.js';
import { isAppUrl } from './protocol-routing.js';
import { isFullscreenChord, isGameSender, maximizedAfter, setFullScreen } from './window-control.js';
import { placeWindow, readWindowState, WINDOW_STATE_VERSION, writeWindowState } from './window-state.js';

/** Button order of the leave dialog; staying is the default and what Escape picks. */
const LEAVE_BUTTON = 0;
const STAY_BUTTON = 1;

export function createWindow(statePath: string): BrowserWindow {
  const state = readWindowState(statePath);
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const win = new BrowserWindow({
    ...placeWindow(state.bounds, workAreas, screen.getPrimaryDisplay().workArea),
    show: false,
    backgroundColor: '#1d1a15',
    webPreferences: {
      // scripts/bundle.mjs emits preload.cjs beside main.cjs.
      preload: join(__dirname, 'preload.cjs'),
      // The session advances on animation frames even while the game is minimized.
      backgroundThrottling: false,
      // Electron 43 defaults, pinned so a future option edit can't silently regress them.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let revealed = false;
  // A page that fails to load never becomes ready to show, and the window must not stay hidden.
  const reveal = (): void => {
    if (revealed) return;
    revealed = true;
    if (state.maximized) win.maximize();
    win.show();
    if (state.fullscreen) win.setFullScreen(true);
  };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-fail-load', reveal);
  let maximized = state.maximized;
  win.on('maximize', () => {
    maximized = maximizedAfter(maximized, 'maximize', win.isFullScreen());
  });
  win.on('unmaximize', () => {
    maximized = maximizedAfter(maximized, 'unmaximize', win.isFullScreen());
  });
  win.on('close', () => {
    try {
      writeWindowState(statePath, {
        version: WINDOW_STATE_VERSION,
        fullscreen: win.isFullScreen(),
        maximized,
        bounds: win.getNormalBounds(),
      });
    } catch {
      // Best effort: a missing or damaged file reopens the first-run window.
    }
  });

  const fromGame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    isGameSender(event.sender === win.webContents, event.senderFrame?.url);
  ipcMain.on(IS_FULLSCREEN_CHANNEL, (event) => {
    event.returnValue = fromGame(event) && win.isFullScreen();
  });
  ipcMain.handle(SET_FULLSCREEN_CHANNEL, (event, active: unknown) => {
    if (!fromGame(event) || typeof active !== 'boolean') return undefined;
    return setFullScreen(win, active);
  });
  win.on('enter-full-screen', () => win.webContents.send(FULLSCREEN_CHANGED_CHANNEL, true));
  win.on('leave-full-screen', () => win.webContents.send(FULLSCREEN_CHANGED_CHANNEL, false));
  win.webContents.on('before-input-event', (event, input) => {
    if (!isFullscreenChord(input)) return;
    event.preventDefault();
    win.setFullScreen(!win.isFullScreen());
  });

  // The page holds its document while a game runs (`beforeunload`); a shell has no prompt of its own
  // for that, so closing or quitting asks here. Letting the handler through keeps the window open.
  win.webContents.on('will-prevent-unload', (event) => {
    const prompt = leavePromptFor(win.webContents.getURL(), app.getLocale());
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      title: prompt.title,
      message: prompt.message,
      buttons: [prompt.leave, prompt.stay],
      defaultId: STAY_BUTTON,
      cancelId: STAY_BUTTON,
    });
    if (choice === LEAVE_BUTTON) event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (!isAppUrl(target)) event.preventDefault();
  });
  void win.loadURL(GAME_URL);
  return win;
}
