import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { CULTURESNATION_HOME_URL, probeGameFolder } from '@open-northland/asset-pipeline';
import { type BrowserWindow, dialog, ipcMain } from 'electron';
import { patchConfig } from './config.js';
import { detectGameFolders } from './detect.js';
import { createEventThrottle } from './event-throttle.js';
import { currentLocale, formatMessage, isLocale, type Locale, messages } from './i18n/index.js';
import type { GameFolderCandidate, IpcInvokeChannel, ModEvent, PipelineEvent } from './ipc.js';
import { IPC_CHANNELS } from './ipc.js';
import { findModRootUnder, installCnMod, isFinalModEvent } from './mod-install/index.js';
import type { PipelineHost } from './pipeline-host.js';
import { gameUrlForLocale } from './protocol.js';
import { isAppUrl } from './protocol-routing.js';
import { applyShellLocale } from './shell-locale.js';
import type { ShellPaths, ShellState } from './shell-state.js';

export interface IpcDeps {
  readonly win: BrowserWindow;
  readonly paths: ShellPaths;
  readonly state: ShellState;
  readonly pipeline: PipelineHost;
}

/** Serves a channel only when the sender frame is one of the shell's own `app://` pages. */
function handleFromAppFrame(channel: IpcInvokeChannel, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isAppUrl(event.senderFrame?.url)) throw new Error('IPC from an untrusted frame');
    return handler(...args);
  });
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

/** Native open-directory dialog; `undefined` when the user cancels. */
async function pickDirectory(win: BrowserWindow, title: string): Promise<string | undefined> {
  const picked = await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] });
  const path = picked.filePaths[0];
  return picked.canceled || path === undefined ? undefined : path;
}

/** Refuses absurd save reads and writes before they hit memory: bytes on read, UTF-16 units on
 *  write - the same magnitude either way, far above a real save's megabytes. */
const MAX_SAVE_FILE_BYTES = 256 * 1024 * 1024;

function saveFileFilters(): { name: string; extensions: string[] }[] {
  return [{ name: messages().dialogs.saveFileFilter, extensions: ['json'] }];
}

export function wireIpc({ win, paths, state, pipeline }: IpcDeps): void {
  handleFromAppFrame(IPC_CHANNELS.getState, () => state.desktopState());
  handleFromAppFrame(IPC_CHANNELS.probeGamePath, (path: unknown) => {
    assertString(path);
    return candidateOf(path);
  });
  handleFromAppFrame(IPC_CHANNELS.detectGameFolders, () => detectGameFolders());
  handleFromAppFrame(IPC_CHANNELS.pickGameFolder, async () => {
    const path = await pickDirectory(win, messages().dialogs.pickGameTitle);
    return path === undefined ? null : candidateOf(path);
  });

  let modDownload: AbortController | undefined;
  handleFromAppFrame(IPC_CHANNELS.runPipeline, async (gamePath: unknown) => {
    assertString(gamePath);
    if (modDownload !== undefined) throw new Error(messages().errors.modStillDownloading);
    const probe = await probeGameFolder(gamePath);
    if (!probe.hasArchives) throw new Error(messages().errors.noArchives);
    // The pipeline auto-detects a mod inside the game folder; only an external one must be passed.
    const modRoot = probe.hasMod ? undefined : await state.availableModRoot();
    if (!probe.hasMod && modRoot === undefined) {
      throw new Error(messages().errors.modRequired);
    }
    pipeline.start(gamePath, paths.contentDir, modRoot, (event: PipelineEvent) => {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.pipelineEvent, event);
    });
    // Remembered only after start() accepted the run, so a double-start throw cannot clobber it.
    patchConfig(paths.configFile, { gamePath });
  });
  handleFromAppFrame(IPC_CHANNELS.stopPipeline, () => pipeline.stop());

  const modEvents = createEventThrottle();
  const forwardModEvent = (event: ModEvent): void => {
    if (!modEvents.shouldEmit(isFinalModEvent(event))) return;
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.modEvent, event);
  };
  handleFromAppFrame(IPC_CHANNELS.downloadMod, async () => {
    if (modDownload !== undefined) throw new Error(messages().errors.modDownloadRunning);
    modDownload = new AbortController();
    try {
      return await installCnMod(paths.modsDir, forwardModEvent, { signal: modDownload.signal });
    } finally {
      modDownload = undefined;
    }
  });
  handleFromAppFrame(IPC_CHANNELS.cancelModDownload, () => {
    modDownload?.abort();
  });
  handleFromAppFrame(IPC_CHANNELS.pickModFolder, async () => {
    const path = await pickDirectory(win, messages().dialogs.pickModTitle);
    if (path === undefined) return null;
    // Accept the mod root itself, its wrapping folder, or a directly-picked DataCnmd child.
    const root = (await findModRootUnder(path)) ?? (await findModRootUnder(dirname(path)));
    if (root === undefined) {
      throw new Error(formatMessage(messages().errors.noDataCnmd, { url: CULTURESNATION_HOME_URL }));
    }
    patchConfig(paths.configFile, { modPath: root });
    return root;
  });

  handleFromAppFrame(IPC_CHANNELS.startGame, async () => {
    // Re-checked here, not only in the setup UI: incompatible content must never boot.
    if ((await state.contentStatus()) === 'stale-schema') {
      throw new Error(messages().errors.incompatibleSchema);
    }
    await win.loadURL(gameUrlForLocale(currentLocale()));
  });

  handleFromAppFrame(IPC_CHANNELS.saveGameFile, async (suggestedName: unknown, contents: unknown) => {
    assertString(suggestedName);
    assertString(contents);
    if (contents.length > MAX_SAVE_FILE_BYTES) throw new Error('save exceeds the size limit');
    const picked = await dialog.showSaveDialog(win, {
      title: messages().dialogs.saveGameTitle,
      // basename: the suggestion crosses the bridge untyped, and a path in it must not steer the dialog.
      defaultPath: basename(suggestedName),
      filters: saveFileFilters(),
    });
    if (picked.canceled || picked.filePath === '') return null;
    await writeFile(picked.filePath, contents, 'utf8');
    return basename(picked.filePath);
  });

  handleFromAppFrame(IPC_CHANNELS.openGameFile, async () => {
    const picked = await dialog.showOpenDialog(win, {
      title: messages().dialogs.loadGameTitle,
      properties: ['openFile'],
      filters: saveFileFilters(),
    });
    const path = picked.filePaths[0];
    if (picked.canceled || path === undefined) return null;
    if ((await stat(path)).size > MAX_SAVE_FILE_BYTES) throw new Error('save exceeds the size limit');
    // The renderer gets the basename only; the full path stays in the main process.
    return { name: basename(path), contents: await readFile(path, 'utf8') };
  });

  handleFromAppFrame(IPC_CHANNELS.setLocale, (locale: unknown) => {
    assertLocale(locale);
    applyShellLocale(win, paths, locale);
  });
}
