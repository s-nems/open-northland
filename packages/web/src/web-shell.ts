import { CURRENT_MANIFEST, readPipelineManifest } from '@open-northland/asset-pipeline/manifest';
import {
  classifyContent,
  createEventThrottle,
  type ModEvent,
  type PipelineEvent,
  requireModRoot,
  type ShellApi,
  type ShellSetupState,
} from '@open-northland/installer';
import type { Locale } from '@open-northland/installer/i18n';
import { messages } from '@open-northland/installer/i18n';
import { discoverInstalledMod, installCnMod, isFinalModEvent } from '@open-northland/installer/mod-install';
import { vjoin } from '@open-northland/vfs';
import { effectiveLocale, storeLocale } from './locale.js';
import { acquireOriginLock } from './locks.js';
import { pickedArchiveDownload, siteArchiveDownload } from './mod-transport.js';
import { CONTENT_DIR, CONTENT_RUNNING_MARKER, MODS_DIR, opfsRoot } from './opfs-layout.js';
import { pickZipFile } from './pickers.js';
import {
  assertRoomForConversion,
  hasRoomForConversion,
  requestPersistentStorage,
  storageFullMessage,
} from './storage.js';
import type { PipelineWorkerMessage, RunPipelineRequest } from './worker/protocol.js';

/** Web Locks names: one conversion and one mod install per origin, whatever the tab count. */
const PIPELINE_LOCK = 'open-northland.pipeline';
const MOD_INSTALL_LOCK = 'open-northland.mod-install';

/** The playable app, served under the site base with the shared content routes beneath it. */
const PLAY_URL = 'play/';

/** Storage exhaustion would otherwise reach the mod panel as a raw DOMException. */
async function withStorageMessage<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = storageFullMessage(error);
    throw message === undefined ? error : new Error(message);
  }
}

export function createWebShellApi(): ShellApi {
  let worker: Worker | undefined;
  let releasePipelineLock: (() => void) | undefined;
  const pipelineListeners: ((event: PipelineEvent) => void)[] = [];
  const modListeners: ((event: ModEvent) => void)[] = [];
  let modInstall: AbortController | undefined;

  const modEvents = createEventThrottle();
  const forwardModEvent = (event: ModEvent): void => {
    if (!modEvents.shouldEmit(isFinalModEvent(event))) return;
    for (const listener of modListeners) listener(event);
  };

  /** OPFS-root-relative, exactly as the worker and the setup page both consume it. */
  async function availableModRoot(): Promise<string | undefined> {
    const fs = await opfsRoot();
    return discoverInstalledMod(fs, MODS_DIR);
  }

  async function contentStatus(): Promise<ShellSetupState['contentStatus']> {
    const fs = await opfsRoot();
    // A run that never finished leaves a tree that would otherwise read as merely out of date, and
    // the page would offer to play it.
    if ((await fs.stat(vjoin(CONTENT_DIR, CONTENT_RUNNING_MARKER))) !== undefined) return 'missing';
    const stored = await readPipelineManifest(fs, CONTENT_DIR);
    const irExists = (await fs.stat(vjoin(CONTENT_DIR, 'ir.json')))?.kind === 'file';
    return classifyContent(stored, CURRENT_MANIFEST, irExists);
  }

  /**
   * The browser's estimate counts the visitor's own leftovers, and both jobs begin by deleting the
   * tree they are about to rewrite. Freeing it before asking is what keeps a run that once ran out
   * of storage from refusing every retry, with nothing on screen that could clear it.
   */
  async function ensureRoomFor(tree: string): Promise<void> {
    await requestPersistentStorage();
    if (await hasRoomForConversion()) return;
    await (await opfsRoot()).rm(tree);
    await assertRoomForConversion();
  }

  /** Closing the tab mid-conversion throws away every minute of it, so the browser is asked to
   *  confirm. Nothing else on the page warrants a prompt, so the handler lives only that long. */
  const confirmUnload = (event: BeforeUnloadEvent): void => event.preventDefault();

  function stopWorker(): void {
    window.removeEventListener('beforeunload', confirmUnload);
    worker?.terminate();
    worker = undefined;
    releasePipelineLock?.();
    releasePipelineLock = undefined;
  }

  /** One install per origin: two of them write the same archive path and the same target tree, and
   *  whichever finished last would mark the mixture complete. */
  async function runModInstall(download: Parameters<typeof installCnMod>[2]): Promise<string> {
    if (modInstall !== undefined) throw new Error(messages().errors.modDownloadRunning);
    const release = await acquireOriginLock(MOD_INSTALL_LOCK);
    if (release === undefined) throw new Error(messages().errors.modInstallElsewhere);
    await ensureRoomFor(MODS_DIR);
    modInstall = new AbortController();
    const { signal } = modInstall;
    try {
      const fs = await opfsRoot();
      return await withStorageMessage(() =>
        installCnMod(fs, MODS_DIR, download, forwardModEvent, { signal }),
      );
    } finally {
      modInstall = undefined;
      release();
    }
  }

  const api: ShellApi = {
    async getState(): Promise<ShellSetupState> {
      const modRoot = await availableModRoot();
      return {
        portable: false,
        locale: effectiveLocale(),
        contentStatus: await contentStatus(),
        modDelivery: 'origin-archive',
        ...(modRoot !== undefined ? { modRoot } : {}),
      };
    },

    async runPipeline(): Promise<void> {
      if (worker !== undefined) throw new Error(messages().errors.pipelineRunning);
      if (modInstall !== undefined) throw new Error(messages().errors.modStillDownloading);
      const modRoot = requireModRoot(await availableModRoot());
      await ensureRoomFor(CONTENT_DIR);
      const release = await acquireOriginLock(PIPELINE_LOCK);
      if (release === undefined) throw new Error(messages().errors.conversionElsewhere);
      releasePipelineLock = release;

      try {
        const spawned = new Worker(new URL('pipeline-worker.js', document.baseURI));
        worker = spawned;
        spawned.onmessage = (event: MessageEvent<PipelineWorkerMessage>) => {
          const message = event.data;
          if (message.kind === 'done' || message.kind === 'error') stopWorker();
          for (const listener of pipelineListeners) listener(message);
        };
        spawned.onerror = () => {
          stopWorker();
          for (const listener of pipelineListeners) {
            listener({ kind: 'error', message: messages().errors.pipelineWorkerCrashed });
          }
        };
        const request: RunPipelineRequest = { kind: 'run', modRoot, locale: effectiveLocale() };
        spawned.postMessage(request);
        window.addEventListener('beforeunload', confirmUnload);
      } catch (error) {
        // Nothing is running, so the lock must not outlive the failed spawn: this tab would then
        // report its own held lock as another tab's conversion.
        stopWorker();
        throw error;
      }
    },

    async stopPipeline(): Promise<void> {
      stopWorker();
    },

    onPipelineEvent(listener: (event: PipelineEvent) => void): void {
      pipelineListeners.push(listener);
    },

    async downloadMod(): Promise<string> {
      return runModInstall(siteArchiveDownload());
    },

    async cancelModDownload(): Promise<void> {
      modInstall?.abort();
    },

    async pickModFolder(): Promise<string | null> {
      const file = await pickZipFile();
      if (file === null) return null;
      return runModInstall(pickedArchiveDownload(file));
    },

    onModEvent(listener: (event: ModEvent) => void): void {
      modListeners.push(listener);
    },

    async startGame(): Promise<void> {
      // Re-checked here, not only in the setup UI: a tree this page wiped or never finished must
      // never boot as if it were content.
      const status = await contentStatus();
      if (status === 'stale-schema') throw new Error(messages().errors.incompatibleSchema);
      if (status === 'missing') throw new Error(messages().errors.contentMissing);
      location.assign(`${PLAY_URL}?lang=${effectiveLocale()}`);
    },

    async setLocale(locale: Locale): Promise<void> {
      storeLocale(locale);
    },
  };
  return api;
}
