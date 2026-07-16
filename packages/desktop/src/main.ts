import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CULTURESNATION_MOD, probeGameFolder } from '@open-northland/asset-pipeline';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readConfig, writeConfig } from './config.js';
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

/** Content counts as installed when the pipeline's final validated artifact is present. */
function contentReady(): boolean {
  return existsSync(join(contentDir, 'ir.json'));
}

function desktopState(): DesktopState {
  const remembered = readConfig(configFile).gamePath;
  return {
    dataRoot: dataRoot.path,
    portable: dataRoot.portable,
    contentReady: contentReady(),
    ...(remembered !== undefined ? { gamePath: remembered } : {}),
  };
}

async function candidateOf(path: string): Promise<GameFolderCandidate> {
  return { path, probe: await probeGameFolder(path) };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#1d1a15',
    webPreferences: { preload: join(here, 'preload.cjs') },
  });
  win.setMenuBarVisibility(false);
  void win.loadURL(contentReady() ? GAME_URL : SETUP_URL);
  return win;
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

void app.whenReady().then(() => {
  handleAppProtocol({ appRoot, setupRoot, contentRoot: contentDir });
  wireIpc(createWindow());
});

app.on('window-all-closed', () => {
  void pipeline.stop().then(() => app.quit());
});
