import { release } from 'node:os';
import { app, type BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, powerMonitor } from 'electron';
import {
  CLEAR_FAULTS_CHANNEL,
  FAULT_VERSIONS_CHANNEL,
  PENDING_FAULTS_CHANNEL,
  PREVIOUS_RUN_CHANNEL,
} from './channels.js';
import { crashPromptFor } from './crash-prompt.js';
import { hungStack } from './hung-stack.js';
import { createCrashReloadGuard } from './reload-guard.js';
import type { ShellRun } from './shell-run.js';
import type { FaultStore, FaultUpdate, NewFault, ShellFault } from './store.js';

/** Button order of the repeated-crash dialog. */
const RESTART_BUTTON = 0;
const QUIT_BUTTON = 1;

/** Recording a fault must never become a second fault. */
function safely<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch (failure) {
    console.error('Could not record a shell fault:', failure);
    return undefined;
  }
}

function errorFault(error: unknown): NewFault {
  const named = error instanceof Error;
  return {
    trigger: 'error',
    reason: named ? error.name : typeof error,
    exitCode: null,
    durationMs: null,
    stack: named ? (error.stack ?? `${error.name}: ${error.message}`) : String(error),
    url: null,
    gpuStatus: null,
  };
}

/**
 * Main-process errors and GPU process deaths, and how the run ends. The exception monitor leaves
 * Electron's own handler, which shows its error dialog, in charge. Electron only warns about an
 * unhandled rejection, and a listener silences that warning, so this one prints it instead.
 */
export function recordProcessFaults(store: FaultStore, run: ShellRun): void {
  app.on('will-quit', () => run.quit());
  app.on('render-process-gone', (_event, _contents, details) => {
    if (details.reason !== 'clean-exit') run.childGone();
  });
  process.on('uncaughtExceptionMonitor', (error) => safely(() => store.record(errorFault(error))));
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection in the main process:', reason);
    safely(() => store.record(errorFault(reason)));
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    run.childGone();
    if (details.type !== 'GPU') return;
    safely(() =>
      store.record({
        trigger: 'gpu-gone',
        reason: details.reason,
        exitCode: details.exitCode,
        durationMs: null,
        stack: null,
        url: null,
        // Tells a GPU process Chromium gave up on (WebGL off or in software) from one it restarts.
        gpuStatus: { ...app.getGPUFeatureStatus() },
      }),
    );
  });
}

/** Build facts for a report; `osRelease` is the kernel's, `osVersion` the system's own number. */
function shellVersions(): Readonly<Record<string, string>> {
  return {
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    osVersion: process.getSystemVersion(),
  };
}

export interface WindowFaultSetup {
  readonly store: FaultStore;
  /** Where a crashed page reloads to: the shell's first page, so the player lands in the menu. */
  readonly startUrl: string;
  readonly fromGame: (event: IpcMainInvokeEvent) => boolean;
  readonly run: ShellRun;
}

/** The game window's renderer crashes and hangs, and the `window.desktop.faults` channels. */
export function watchWindowFaults(
  win: BrowserWindow,
  { store, startUrl, fromGame, run }: WindowFaultSetup,
): void {
  const contents = win.webContents;
  const guard = createCrashReloadGuard();
  let hang: { readonly id: string; readonly sinceMs: number } | undefined;
  const update = (id: string, patch: FaultUpdate): void => {
    safely(() => store.update(id, patch));
  };

  contents.on('render-process-gone', (_event, details) => {
    const url = contents.getURL();
    hang = undefined;
    safely(() =>
      store.record({
        trigger: 'renderer-gone',
        reason: details.reason,
        exitCode: details.exitCode,
        durationMs: null,
        stack: null,
        url,
        gpuStatus: null,
      }),
    );
    if (win.isDestroyed()) return;
    if (guard.reloadWithoutAsking(Date.now())) {
      void win.loadURL(startUrl);
      return;
    }
    const prompt = crashPromptFor(url, app.getLocale());
    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: prompt.title,
        message: prompt.message,
        buttons: [prompt.restart, prompt.quit],
        defaultId: RESTART_BUTTON,
        cancelId: QUIT_BUTTON,
      })
      .then(({ response }) => {
        if (response === QUIT_BUTTON) app.quit();
        else if (!win.isDestroyed()) void win.loadURL(startUrl);
      });
  });

  // Chromium reports a hang only after its own hang timeout, so the duration counts from that report.
  win.on('unresponsive', () => {
    if (hang !== undefined) return;
    const fault: ShellFault | undefined = safely(() =>
      store.record({
        trigger: 'renderer-unresponsive',
        reason: 'unresponsive',
        exitCode: null,
        durationMs: null,
        stack: null,
        url: contents.getURL(),
        gpuStatus: null,
      }),
    );
    if (fault === undefined) return;
    hang = { id: fault.id, sinceMs: Date.now() };
    void hungStack(contents).then((stack) => {
      if (stack !== undefined) update(fault.id, { stack });
    });
  });
  win.on('responsive', () => {
    if (hang === undefined) return;
    update(hang.id, { durationMs: Date.now() - hang.sinceMs });
    hang = undefined;
  });

  // Windows ends a session through the window, macOS and Linux through the power monitor.
  win.on('session-end', () => run.shuttingDown());
  powerMonitor.on('shutdown', () => run.shuttingDown());
  powerMonitor.on('suspend', () => run.suspended());
  powerMonitor.on('resume', () => run.resumed());

  ipcMain.handle(PENDING_FAULTS_CHANNEL, (event) => {
    if (!fromGame(event)) throw new Error('Refused');
    return store.pending();
  });
  ipcMain.handle(CLEAR_FAULTS_CHANNEL, (event, ids: unknown) => {
    if (!fromGame(event)) throw new Error('Refused');
    store.clear(ids);
  });
  ipcMain.handle(FAULT_VERSIONS_CHANNEL, (event) => {
    if (!fromGame(event)) throw new Error('Refused');
    return shellVersions();
  });
  ipcMain.handle(PREVIOUS_RUN_CHANNEL, (event) => {
    if (!fromGame(event)) throw new Error('Refused');
    return run.previous;
  });
}
