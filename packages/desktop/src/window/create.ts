import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  screen,
  shell,
} from 'electron';
import type { ShellRun } from '../faults/shell-run.js';
import type { FaultStore } from '../faults/store.js';
import { watchWindowFaults } from '../faults/watch.js';
import {
  CANCEL_LOCAL_MAP_PICK_CHANNEL,
  COMMIT_MAPS_CHANNEL,
  DROP_LOCAL_MAP_CHANNEL,
  LIST_MAPS_CHANNEL,
  PICK_LOCAL_MAP_CHANNEL,
  READ_MAP_CHANNEL,
  READ_MAP_FILE_CHANNEL,
  READ_MAP_SOURCE_CHANNEL,
} from '../maps/channels.js';
import { createLocalMapPicker } from '../maps/local-input.js';
import { createDesktopMapStore } from '../maps/store.js';
import { ORIGINAL_GAME_STATUS_CHANNEL, PICK_ORIGINAL_GAME_CHANNEL } from '../original-game/channels.js';
import {
  folderPickProperties,
  type OriginalGamePick,
  type OriginalGameRecord,
  originalGameStatus,
  pickOriginalGame,
} from '../original-game/gate.js';
import { externalPageUrl, isAppUrl } from '../protocol/routing.js';
import { isFullscreenChord, isGameSender, maximizedAfter, setFullScreen } from './control.js';
import {
  FULLSCREEN_CHANGED_CHANNEL,
  IS_FULLSCREEN_CHANNEL,
  SET_FULLSCREEN_CHANNEL,
} from './fullscreen-channels.js';
import { leavePromptFor } from './leave-prompt.js';
import {
  placeWindow,
  readWindowState,
  startupWindowState,
  WINDOW_STATE_VERSION,
  writeWindowState,
} from './state.js';

/** Button order of the leave dialog; staying is the default and what Escape picks. */
const LEAVE_BUTTON = 0;
const STAY_BUTTON = 1;

export interface WindowSetup {
  readonly statePath: string;
  /** `installedMapsRoot` of the profile. */
  readonly mapsRoot: string;
  /** The first page, the game URL with any override the environment set. */
  readonly startUrl: string;
  readonly originalGame: OriginalGameRecord;
  readonly faults: FaultStore;
  readonly run: ShellRun;
}

export function createWindow({
  statePath,
  mapsRoot,
  startUrl,
  originalGame,
  faults,
  run,
}: WindowSetup): BrowserWindow {
  const state = startupWindowState(
    readWindowState(statePath),
    app.isPackaged || process.env.ON_DESKTOP_RESTORE_WINDOW === '1',
  );
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
  ipcMain.handle(ORIGINAL_GAME_STATUS_CHANNEL, (event) =>
    fromGame(event) ? originalGameStatus(originalGame) : undefined,
  );
  // One dialog at a time: a second invoke while it is open shares its answer.
  let picking: Promise<OriginalGamePick> | null = null;
  ipcMain.handle(PICK_ORIGINAL_GAME_CHANNEL, (event) => {
    if (!fromGame(event)) return undefined;
    picking ??= pickOriginalGame(originalGame, async () => {
      const picked = await dialog.showOpenDialog(win, {
        properties: folderPickProperties(process.platform),
      });
      return picked.canceled ? undefined : picked.filePaths[0];
    }).finally(() => {
      picking = null;
    });
    return picking;
  });
  const maps = createDesktopMapStore(mapsRoot);
  const localPicker = createLocalMapPicker(async (kind) => {
    const selected = await dialog.showOpenDialog(win, {
      properties: kind === 'folder' ? ['openDirectory', 'dontAddToRecent'] : ['openFile', 'dontAddToRecent'],
      ...(kind === 'folder' ? {} : { filters: [{ name: 'Maps', extensions: ['zip', 'rar', 'c2m', 'exe'] }] }),
    });
    return selected.canceled ? undefined : selected.filePaths[0];
  });
  win.on('closed', () => localPicker.cancel());
  ipcMain.handle(DROP_LOCAL_MAP_CHANNEL, (event, path: unknown) => {
    if (!fromGame(event)) throw new Error('Refused');
    return localPicker.drop(path);
  });
  ipcMain.handle(PICK_LOCAL_MAP_CHANNEL, (event, kind: unknown) => {
    if (!fromGame(event)) throw new Error('Refused');
    return localPicker.pick(kind);
  });
  ipcMain.handle(CANCEL_LOCAL_MAP_PICK_CHANNEL, (event) => {
    if (!fromGame(event)) throw new Error('Refused');
    localPicker.cancel();
  });
  ipcMain.handle(READ_MAP_SOURCE_CHANNEL, (event, entryId: unknown) => {
    if (!fromGame(event)) throw new Error('Refused');
    return maps.readSource(entryId);
  });
  ipcMain.handle(LIST_MAPS_CHANNEL, (event) => {
    if (!fromGame(event)) throw new Error('Refused');
    return maps.list();
  });
  ipcMain.handle(READ_MAP_CHANNEL, (event, mapId: unknown) => {
    if (!fromGame(event)) throw new Error('Refused');
    return maps.readMap(mapId);
  });
  ipcMain.handle(READ_MAP_FILE_CHANNEL, (event, mapId: unknown, suffix: unknown) => {
    if (!fromGame(event)) throw new Error('Refused');
    return maps.readFile(mapId, suffix);
  });
  ipcMain.handle(COMMIT_MAPS_CHANNEL, (event, drop: unknown, put: unknown, sources: unknown) => {
    if (!fromGame(event)) throw new Error('Refused');
    return maps.commit(drop, put, sources);
  });
  watchWindowFaults(win, { store: faults, startUrl, fromGame, run });
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

  // A catalogue page link opens in the system browser; the game window never opens another one.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const page = externalPageUrl(url);
    if (page !== null) void shell.openExternal(page);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!isAppUrl(target)) event.preventDefault();
  });
  void win.loadURL(startUrl);
  return win;
}
