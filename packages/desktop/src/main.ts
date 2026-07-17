import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { wireIpc } from './ipc-handlers.js';
import { configFileOf, contentDirOf, DATA_DIR_ENV, modsDirOf, resolveDataRoot } from './paths.js';
import { PipelineHost } from './pipeline-host.js';
import { handleAppProtocol, registerAppScheme } from './protocol.js';
import { createShellState, type ShellPaths } from './shell-state.js';
import { buildAppMenu, createWindow } from './window.js';

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
const paths: ShellPaths = {
  dataRoot,
  contentDir: contentDirOf(dataRoot.path),
  configFile: configFileOf(dataRoot.path),
  modsDir: modsDirOf(dataRoot.path),
};
const state = createShellState(paths);
const pipeline = new PipelineHost(join(here, 'pipeline-child.cjs'));

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
    handleAppProtocol({ appRoot, setupRoot, contentRoot: paths.contentDir });
    mainWindow = createWindow(await state.contentStatus(), join(here, 'preload.cjs'));
    buildAppMenu(mainWindow, dataRoot.path);
    wireIpc({ win: mainWindow, paths, state, pipeline });
  });
} else {
  app.quit();
}

// Quits on macOS too, deliberately: a single-window game shell has nothing to reopen from the Dock.
app.on('window-all-closed', () => {
  void pipeline.stop().then(() => app.quit());
});
