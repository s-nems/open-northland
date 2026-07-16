import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  CULTURESNATION_MOD,
  CURRENT_MANIFEST,
  probeGameFolder,
  readPipelineManifest,
} from '@open-northland/asset-pipeline';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { readConfig, writeConfig } from './config.js';
import { type ContentStatus, classifyContent } from './content-state.js';
import { detectGameFolders } from './detect.js';
import type { DesktopState, GameFolderCandidate, PipelineEvent } from './ipc.js';
import { IPC_CHANNELS } from './ipc.js';
import { configFileOf, contentDirOf, DATA_DIR_ENV, resolveDataRoot } from './paths.js';
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

const pipeline = new PipelineHost(join(here, 'pipeline-child.cjs'));

/** Compare the data root's conversion stamp to this shell's pipeline; see `content-state.ts`. */
async function contentStatus(): Promise<ContentStatus> {
  const stored = await readPipelineManifest(contentDir);
  return classifyContent(stored, CURRENT_MANIFEST, existsSync(join(contentDir, 'ir.json')));
}

async function desktopState(): Promise<DesktopState> {
  const remembered = readConfig(configFile).gamePath;
  return {
    dataRoot: dataRoot.path,
    portable: dataRoot.portable,
    contentStatus: await contentStatus(),
    ...(remembered !== undefined ? { gamePath: remembered } : {}),
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
    // Hidden until Alt on Windows/Linux (macOS keeps the system bar) — the menu carries the
    // reinstall-content and open-data-folder actions, so it must stay reachable.
    autoHideMenuBar: true,
    webPreferences: { preload: join(here, 'preload.cjs') },
  });
  void win.loadURL(initial === 'ready' ? GAME_URL : SETUP_URL);
  return win;
}

/** The native menu owns the shell-level actions the in-game UI must not know about. */
function buildAppMenu(win: BrowserWindow): void {
  const gameSubmenu: Electron.MenuItemConstructorOptions[] = [
    // The setup page reads the current content status and offers Regenerate / Play accordingly.
    { label: 'Reinstall game content…', click: () => void win.loadURL(SETUP_URL) },
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

function wireIpc(win: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.getState, () => desktopState());
  ipcMain.handle(IPC_CHANNELS.probeGamePath, (_ev, path: string) => candidateOf(path));
  ipcMain.handle(IPC_CHANNELS.detectGameFolders, () => detectGameFolders());
  ipcMain.handle(IPC_CHANNELS.pickGameFolder, async () => {
    const picked = await dialog.showOpenDialog(win, {
      title: 'Select your Cultures - 8th Wonder of the World folder',
      properties: ['openDirectory'],
    });
    const path = picked.filePaths[0];
    return picked.canceled || path === undefined ? null : candidateOf(path);
  });
  ipcMain.handle(IPC_CHANNELS.runPipeline, async (_ev, gamePath: string) => {
    const probe = await probeGameFolder(gamePath);
    if (!probe.hasArchives) throw new Error('no game archives (.lib) found under the selected folder');
    writeConfig(configFile, { gamePath });
    pipeline.start(
      gamePath,
      contentDir,
      probe.hasMod ? CULTURESNATION_MOD : undefined,
      (event: PipelineEvent) => {
        if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.pipelineEvent, event);
      },
    );
  });
  ipcMain.handle(IPC_CHANNELS.startGame, () => win.loadURL(GAME_URL));
}

registerAppScheme();

void app.whenReady().then(async () => {
  handleAppProtocol({ appRoot, setupRoot, contentRoot: contentDir });
  const win = createWindow(await contentStatus());
  buildAppMenu(win);
  wireIpc(win);
});

app.on('window-all-closed', () => {
  void pipeline.stop().then(() => app.quit());
});
