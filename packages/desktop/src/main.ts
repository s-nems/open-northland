import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  CULTURESNATION_HOME_URL,
  CURRENT_MANIFEST,
  probeGameFolder,
  readPipelineManifest,
} from '@open-northland/asset-pipeline';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { readConfig, writeConfig } from './config.js';
import { type ContentStatus, classifyContent } from './content-state.js';
import { detectGameFolders } from './detect.js';
import type { DesktopState, GameFolderCandidate, ModEvent, PipelineEvent } from './ipc.js';
import { IPC_CHANNELS } from './ipc.js';
import { discoverInstalledMod, findModRootUnder, installCnMod } from './mod-install.js';
import { configFileOf, contentDirOf, DATA_DIR_ENV, modsDirOf, resolveDataRoot } from './paths.js';
import { PipelineHost } from './pipeline-host.js';
import { GAME_URL, handleAppProtocol, registerAppScheme, SETUP_URL } from './protocol.js';

/**
 * The desktop shell's main process: resolve the data root, serve the game over `app://`, and run
 * the first-run installer (pick the owned game folder → convert it with the asset pipeline into the
 * data root → boot the game). The web app itself is byte-identical to the browser build.
 */

// dist/ layout (scripts/bundle.mjs): main.cjs + preload.cjs + pipeline-child.cjs beside each other,
// the setup page under dist/renderer/. The built web app sits in resources/app when packaged, at
// packages/app/dist in a dev checkout (two dirs up from dist/).
const here = __dirname;
const packageRoot = resolve(here, '..');
const repoRoot = resolve(packageRoot, '../..');
const appRoot = app.isPackaged ? join(process.resourcesPath, 'app') : resolve(repoRoot, 'packages/app/dist');
const setupRoot = join(here, 'renderer');

const dataRoot = resolveDataRoot({
  envOverride: process.env[DATA_DIR_ENV],
  execDir: dirname(process.execPath),
  userDataDir: app.getPath('userData'),
  devRepoRoot: app.isPackaged ? undefined : repoRoot,
  directoryExists: existsSync,
});
const contentDir = contentDirOf(dataRoot.path);
const configFile = configFileOf(dataRoot.path);
const modsDir = modsDirOf(dataRoot.path);

const pipeline = new PipelineHost(join(here, 'pipeline-child.cjs'));

/**
 * A usable mod root outside the game folder: the config's hand-picked folder (re-validated — the
 * user may have deleted it) first, then a mod downloaded into the data root's `mods/`.
 */
async function availableModRoot(): Promise<string | undefined> {
  const remembered = readConfig(configFile).modPath;
  if (remembered !== undefined) {
    const validated = await findModRootUnder(remembered);
    if (validated !== undefined) return validated;
  }
  return discoverInstalledMod(modsDir);
}

/** Compare the data root's conversion stamp to this shell's pipeline; see `content-state.ts`. */
async function contentStatus(): Promise<ContentStatus> {
  const stored = await readPipelineManifest(contentDir);
  return classifyContent(stored, CURRENT_MANIFEST, existsSync(join(contentDir, 'ir.json')));
}

async function desktopState(): Promise<DesktopState> {
  const remembered = readConfig(configFile).gamePath;
  const modRoot = await availableModRoot();
  return {
    dataRoot: dataRoot.path,
    portable: dataRoot.portable,
    contentStatus: await contentStatus(),
    ...(remembered !== undefined ? { gamePath: remembered } : {}),
    ...(modRoot !== undefined ? { modRoot } : {}),
  };
}

async function candidateOf(path: string): Promise<GameFolderCandidate> {
  return { path, probe: await probeGameFolder(path) };
}

function createWindow(initial: ContentStatus): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#1d1a15',
    // The menu bar stays visible on Windows/Linux: it is the only home of the reinstall-content
    // and open-data-folder actions, and a bar hidden behind Alt is undiscoverable.
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      // Electron 43 defaults, pinned so a future option edit can't silently regress them.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // The window renders only the shell's own app:// pages — no popups, no navigation elsewhere.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith('app://')) event.preventDefault();
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

/** The native menu owns the shell-level actions the in-game UI must not know about. */
function buildAppMenu(win: BrowserWindow): void {
  const gameSubmenu: Electron.MenuItemConstructorOptions[] = [
    // The setup page reads the current content status and offers Regenerate / Play accordingly.
    { label: 'Reinstall game content…', click: () => void openSetupPage(win) },
    { label: 'Open data folder', click: () => void shell.openPath(dataRoot.path) },
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

/** Every invoke must come from one of the shell's own app:// pages; a foreign frame gets nothing. */
function assertAppSender(event: Electron.IpcMainInvokeEvent): void {
  if (!(event.senderFrame?.url ?? '').startsWith('app://')) {
    throw new Error('IPC from an untrusted frame');
  }
}

/** IPC arguments cross the bridge untyped; reject anything a tampered renderer could substitute. */
function assertString(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('expected a string argument');
}

function wireIpc(win: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.getState, (ev) => {
    assertAppSender(ev);
    return desktopState();
  });
  ipcMain.handle(IPC_CHANNELS.probeGamePath, (ev, path: unknown) => {
    assertAppSender(ev);
    assertString(path);
    return candidateOf(path);
  });
  ipcMain.handle(IPC_CHANNELS.detectGameFolders, (ev) => {
    assertAppSender(ev);
    return detectGameFolders();
  });
  ipcMain.handle(IPC_CHANNELS.pickGameFolder, async (ev) => {
    assertAppSender(ev);
    const picked = await dialog.showOpenDialog(win, {
      title: 'Select your Cultures - 8th Wonder of the World folder',
      properties: ['openDirectory'],
    });
    const path = picked.filePaths[0];
    return picked.canceled || path === undefined ? null : candidateOf(path);
  });
  ipcMain.handle(IPC_CHANNELS.runPipeline, async (ev, gamePath: unknown) => {
    assertAppSender(ev);
    assertString(gamePath);
    const probe = await probeGameFolder(gamePath);
    if (!probe.hasArchives) throw new Error('no game archives (.lib) found under the selected folder');
    // A mod inside the game folder is auto-detected by the pipeline; otherwise pass the external
    // mod root — the conversion is materially incomplete without the mod, so none anywhere is an error.
    const modRoot = probe.hasMod ? undefined : await availableModRoot();
    if (!probe.hasMod && modRoot === undefined) {
      throw new Error(
        'the culturesnation mod is required — download it below, or point the wizard at an unpacked copy',
      );
    }
    pipeline.start(gamePath, contentDir, modRoot, (event: PipelineEvent) => {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.pipelineEvent, event);
    });
    // Remembered only after start() accepted the run — a double-start throw must not clobber it.
    writeConfig(configFile, { ...readConfig(configFile), gamePath });
  });
  ipcMain.handle(IPC_CHANNELS.stopPipeline, (ev) => {
    assertAppSender(ev);
    return pipeline.stop();
  });
  let modDownload: AbortController | undefined;
  ipcMain.handle(IPC_CHANNELS.downloadMod, async (ev) => {
    assertAppSender(ev);
    if (modDownload !== undefined) throw new Error('mod download already running');
    modDownload = new AbortController();
    try {
      return await installCnMod(
        modsDir,
        (event: ModEvent) => {
          if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.modEvent, event);
        },
        { signal: modDownload.signal },
      );
    } finally {
      modDownload = undefined;
    }
  });
  ipcMain.handle(IPC_CHANNELS.cancelModDownload, (ev) => {
    assertAppSender(ev);
    modDownload?.abort();
  });
  ipcMain.handle(IPC_CHANNELS.pickModFolder, async (ev) => {
    assertAppSender(ev);
    const picked = await dialog.showOpenDialog(win, {
      title: 'Select the unpacked CulturesNation mod folder',
      properties: ['openDirectory'],
    });
    const path = picked.filePaths[0];
    if (picked.canceled || path === undefined) return null;
    // Accept the mod root itself, its wrapping folder, or a directly-picked DataCnmd child.
    const root = (await findModRootUnder(path)) ?? (await findModRootUnder(dirname(path)));
    if (root === undefined) {
      throw new Error(
        `no DataCnmd/ found there — pick the unpacked mod folder (download it from ${CULTURESNATION_HOME_URL})`,
      );
    }
    writeConfig(configFile, { ...readConfig(configFile), modPath: root });
    return root;
  });
  ipcMain.handle(IPC_CHANNELS.startGame, async (ev) => {
    assertAppSender(ev);
    // Re-checked here, not only in the setup UI: incompatible content must never boot.
    if ((await contentStatus()) === 'stale-schema') {
      throw new Error('content was generated for an incompatible schema — regenerate it first');
    }
    await win.loadURL(GAME_URL);
  });
}

// One shell per data root: a second instance would race a second conversion into the same content/.
if (app.requestSingleInstanceLock()) {
  registerAppScheme();

  let mainWindow: BrowserWindow | undefined;
  app.on('second-instance', () => {
    if (mainWindow === undefined) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    handleAppProtocol({ appRoot, setupRoot, contentRoot: contentDir });
    mainWindow = createWindow(await contentStatus());
    buildAppMenu(mainWindow);
    wireIpc(mainWindow);
  });
} else {
  app.quit();
}

// Quits on macOS too, deliberately: a single-window game shell has nothing to reopen from the Dock.
app.on('window-all-closed', () => {
  void pipeline.stop().then(() => app.quit());
});
