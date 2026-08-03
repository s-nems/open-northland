import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { readConfig } from './config.js';
import { currentLocale, resolveLocale, setActiveLocale } from './i18n/index.js';
import { wireIpc } from './ipc-handlers.js';
import { configFileOf, contentDirOf, DATA_DIR_ENV, modsDirOf, resolveDataRoot } from './paths.js';
import { PipelineHost } from './pipeline-host.js';
import { handleAppProtocol, registerAppScheme } from './protocol.js';
import { createShellState, type ShellPaths } from './shell-state.js';
import { buildAppMenu, createWindow } from './window.js';

// scripts/bundle.mjs emits main.cjs, preload.cjs, and pipeline-child.cjs side by side into dist/,
// with the setup page under dist/renderer/.
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

  // Set before any window or menu so both the setup page and the native menu open localized.
  setActiveLocale(readConfig(paths.configFile).locale ?? resolveLocale(app.getLocale()));

  void app.whenReady().then(async () => {
    handleAppProtocol({ appRoot, setupRoot, contentRoot: paths.contentDir });
    mainWindow = createWindow(await state.contentStatus(), join(here, 'preload.cjs'), currentLocale());
    buildAppMenu(mainWindow, dataRoot.path);
    wireIpc({ win: mainWindow, paths, state, pipeline });
  });
} else {
  app.quit();
}

// Quits on macOS too: a single-window game shell has nothing to reopen from the Dock.
app.on('window-all-closed', () => {
  void pipeline.stop().then(() => app.quit());
});
