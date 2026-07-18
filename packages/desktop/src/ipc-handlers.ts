import { dirname } from 'node:path';
import { CULTURESNATION_HOME_URL, probeGameFolder } from '@open-northland/asset-pipeline';
import { type BrowserWindow, dialog, ipcMain } from 'electron';
import { readConfig, writeConfig } from './config.js';
import { detectGameFolders } from './detect.js';
import { createEventThrottle } from './event-throttle.js';
import {
  currentLocale,
  formatMessage,
  isLocale,
  type Locale,
  messages,
  setActiveLocale,
} from './i18n/index.js';
import type { GameFolderCandidate, ModEvent, PipelineEvent } from './ipc.js';
import { IPC_CHANNELS } from './ipc.js';
import { findModRootUnder, installCnMod } from './mod-install/index.js';
import type { PipelineHost } from './pipeline-host.js';
import { APP_ORIGIN_PREFIX, gameUrlForLocale } from './protocol.js';
import type { ShellPaths, ShellState } from './shell-state.js';
import { buildAppMenu } from './window.js';

/**
 * The main-process end of every {@link IPC_CHANNELS} call: the setup renderer's only way to reach
 * the game folder, the conversion, and the mod installer. Each handler re-checks its sender and its
 * arguments — the renderer is sandboxed but not trusted.
 */

export interface IpcDeps {
  readonly win: BrowserWindow;
  readonly paths: ShellPaths;
  readonly state: ShellState;
  readonly pipeline: PipelineHost;
}

/** Every invoke must come from one of the shell's own app:// pages; a foreign frame gets nothing. */
function assertAppSender(event: Electron.IpcMainInvokeEvent): void {
  if (!(event.senderFrame?.url ?? '').startsWith(APP_ORIGIN_PREFIX)) {
    throw new Error('IPC from an untrusted frame');
  }
}

/** IPC arguments cross the bridge untyped; reject anything a tampered renderer could substitute. */
function assertString(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('expected a string argument');
}

function assertLocale(value: unknown): asserts value is Locale {
  if (!isLocale(value)) throw new Error('expected a supported locale');
}

async function candidateOf(path: string): Promise<GameFolderCandidate> {
  return { path, probe: await probeGameFolder(path) };
}

export function wireIpc({ win, paths, state, pipeline }: IpcDeps): void {
  ipcMain.handle(IPC_CHANNELS.getState, (ev) => {
    assertAppSender(ev);
    return state.desktopState();
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
      title: messages().dialogs.pickGameTitle,
      properties: ['openDirectory'],
    });
    const path = picked.filePaths[0];
    return picked.canceled || path === undefined ? null : candidateOf(path);
  });

  let modDownload: AbortController | undefined;
  ipcMain.handle(IPC_CHANNELS.runPipeline, async (ev, gamePath: unknown) => {
    assertAppSender(ev);
    assertString(gamePath);
    if (modDownload !== undefined) throw new Error(messages().errors.modStillDownloading);
    const probe = await probeGameFolder(gamePath);
    if (!probe.hasArchives) throw new Error(messages().errors.noArchives);
    // A mod inside the game folder is auto-detected by the pipeline; otherwise pass the external
    // mod root — the conversion is materially incomplete without the mod, so none anywhere is an error.
    const modRoot = probe.hasMod ? undefined : await state.availableModRoot();
    if (!probe.hasMod && modRoot === undefined) {
      throw new Error(messages().errors.modRequired);
    }
    pipeline.start(gamePath, paths.contentDir, modRoot, (event: PipelineEvent) => {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.pipelineEvent, event);
    });
    // Remembered only after start() accepted the run — a double-start throw must not clobber it.
    writeConfig(paths.configFile, { ...readConfig(paths.configFile), gamePath });
  });
  ipcMain.handle(IPC_CHANNELS.stopPipeline, (ev) => {
    assertAppSender(ev);
    return pipeline.stop();
  });

  // The installer ticks per chunk/per extracted file (tens of thousands of events); warnings and
  // each phase's final tick always reach the renderer, the rest ride the shared throttle.
  const modEvents = createEventThrottle();
  const forwardModEvent = (event: ModEvent): void => {
    const final =
      event.kind === 'mod-warning' ||
      (event.kind === 'mod-download' && event.total !== undefined && event.received >= event.total) ||
      (event.kind === 'mod-extract' && event.done >= event.total);
    if (!modEvents.shouldEmit(final)) return;
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.modEvent, event);
  };
  ipcMain.handle(IPC_CHANNELS.downloadMod, async (ev) => {
    assertAppSender(ev);
    if (modDownload !== undefined) throw new Error(messages().errors.modDownloadRunning);
    modDownload = new AbortController();
    try {
      return await installCnMod(paths.modsDir, forwardModEvent, { signal: modDownload.signal });
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
      title: messages().dialogs.pickModTitle,
      properties: ['openDirectory'],
    });
    const path = picked.filePaths[0];
    if (picked.canceled || path === undefined) return null;
    // Accept the mod root itself, its wrapping folder, or a directly-picked DataCnmd child.
    const root = (await findModRootUnder(path)) ?? (await findModRootUnder(dirname(path)));
    if (root === undefined) {
      throw new Error(formatMessage(messages().errors.noDataCnmd, { url: CULTURESNATION_HOME_URL }));
    }
    writeConfig(paths.configFile, { ...readConfig(paths.configFile), modPath: root });
    return root;
  });

  ipcMain.handle(IPC_CHANNELS.startGame, async (ev) => {
    assertAppSender(ev);
    // Re-checked here, not only in the setup UI: incompatible content must never boot.
    if ((await state.contentStatus()) === 'stale-schema') {
      throw new Error(messages().errors.incompatibleSchema);
    }
    await win.loadURL(gameUrlForLocale(currentLocale()));
  });

  ipcMain.handle(IPC_CHANNELS.setLocale, (ev, locale: unknown) => {
    assertAppSender(ev);
    assertLocale(locale);
    setActiveLocale(locale);
    writeConfig(paths.configFile, { ...readConfig(paths.configFile), locale });
    // The native menu is already built; rebuild it so its labels follow the renderer's new language.
    buildAppMenu(win, paths.dataRoot.path);
  });
}
