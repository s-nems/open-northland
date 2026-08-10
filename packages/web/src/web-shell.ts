import { CURRENT_MANIFEST, readPipelineManifest } from '@open-northland/asset-pipeline/manifest';
import { probeGameFolder } from '@open-northland/asset-pipeline/probe';
import {
  classifyContent,
  createEventThrottle,
  type GameFolderCandidate,
  type ModEvent,
  type PickedFolder,
  type PipelineEvent,
  type ShellApi,
  type ShellSetupState,
} from '@open-northland/installer';
import { snapshotDirectoryHandle, snapshotFileList } from '@open-northland/installer/folder';
import type { Locale } from '@open-northland/installer/i18n';
import { messages } from '@open-northland/installer/i18n';
import { discoverInstalledMod, installCnMod, isFinalModEvent } from '@open-northland/installer/mod-install';
import { vjoin } from '@open-northland/vfs';
import { fileMapVfs } from '@open-northland/vfs/opfs';
import { effectiveLocale, storeLocale } from './locale.js';
import { CONTENT_DIR, MODS_DIR, opfsRoot } from './opfs-layout.js';
import { assertRoomForConversion, requestPersistentStorage, storageFullMessage } from './storage.js';
import type { PipelineWorkerMessage, RunPipelineRequest } from './worker/protocol.js';

/** Web Locks name guarding the one conversion this origin may run at a time. */
const PIPELINE_LOCK = 'open-northland.pipeline';

/** Where the site hosts the CnMod archive, beside the game path (same origin, no CORS). */
const CNMOD_ARCHIVE_URL = new URL('../cnmod/cnmod.zip', document.baseURI);

/** The playable app, served under the site base with the shared content routes beneath it. */
const PLAY_URL = 'play/';

/** Streams `response` into an OPFS file chunk by chunk - the ~600 MB archive must never sit in
 *  memory whole. Resolves to undefined: the web transport has no streaming hash, and the archive
 *  comes from this site anyway. */
async function streamToOpfsFile(
  destZip: string,
  response: Response,
  onEvent: (event: ModEvent) => void,
  signal: AbortSignal | undefined,
): Promise<undefined> {
  if (response.body === null) throw new Error('mod download: empty response body');
  const lengthHeader = response.headers.get('content-length');
  const total = lengthHeader === null ? undefined : Number.parseInt(lengthHeader, 10);
  let dir = await navigator.storage.getDirectory();
  const segments = destZip.split('/');
  const name = segments.pop();
  if (name === undefined || name === '') throw new Error(`mod download: unusable path ${destZip}`);
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true });
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      received += value.length;
      onEvent({ kind: 'mod-download', received, ...(total !== undefined ? { total } : {}) });
    }
  } finally {
    await writable.close();
  }
  return undefined;
}

/** Storage exhaustion would otherwise reach the mod panel as a raw DOMException. */
async function withStorageMessage<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = storageFullMessage(error);
    throw message === undefined ? error : new Error(message);
  }
}

/** `showDirectoryPicker` is Chromium-only (WICG File System Access); absent elsewhere. */
interface DirectoryPickerWindow {
  showDirectoryPicker?(options?: { readonly id?: string }): Promise<FileSystemDirectoryHandle>;
}

/** Every capability this shell implements. A new optional member on `ShellApi` fails this build
 *  until the web shell either implements it or is listed here as not offering it. */
type WebShellApi = Required<Omit<ShellApi, 'probeGamePath' | 'detectGameFolders'>>;

export function createWebShellApi(): ShellApi {
  let picked: PickedFolder | undefined;
  let worker: Worker | undefined;
  let releasePipelineLock: (() => void) | undefined;
  const pipelineListeners: ((event: PipelineEvent) => void)[] = [];
  const modListeners: ((event: ModEvent) => void)[] = [];
  let modDownload: AbortController | undefined;

  const modEvents = createEventThrottle();
  const forwardModEvent = (event: ModEvent): void => {
    if (!modEvents.shouldEmit(isFinalModEvent(event))) return;
    for (const listener of modListeners) listener(event);
  };

  async function candidateOf(folder: PickedFolder): Promise<GameFolderCandidate> {
    picked = folder;
    return { path: folder.name, probe: await probeGameFolder(fileMapVfs(folder.files), '') };
  }

  /** OPFS-root-relative, exactly as the worker's data mount and the setup page both consume it. */
  async function availableModRoot(): Promise<string | undefined> {
    const fs = await opfsRoot();
    return discoverInstalledMod(fs, MODS_DIR);
  }

  async function contentStatus(): Promise<ShellSetupState['contentStatus']> {
    const fs = await opfsRoot();
    const stored = await readPipelineManifest(fs, CONTENT_DIR);
    const irExists = (await fs.stat(vjoin(CONTENT_DIR, 'ir.json')))?.kind === 'file';
    return classifyContent(stored, CURRENT_MANIFEST, irExists);
  }

  function stopWorker(): void {
    worker?.terminate();
    worker = undefined;
    releasePipelineLock?.();
    releasePipelineLock = undefined;
  }

  /**
   * One conversion per origin: two tabs writing into the same content tree would interleave, and
   * whichever finished last would stamp the mixture as ready. The lock is held for as long as the
   * worker runs, so it is released from {@link stopWorker} rather than by awaiting the callback.
   */
  async function holdPipelineLock(): Promise<boolean> {
    if (navigator.locks === undefined) return true;
    return new Promise<boolean>((resolve) => {
      void navigator.locks.request(PIPELINE_LOCK, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve(false);
          return Promise.resolve();
        }
        resolve(true);
        return new Promise<void>((release) => {
          releasePipelineLock = release;
        });
      });
    });
  }

  const api: WebShellApi = {
    async getState(): Promise<ShellSetupState> {
      const modRoot = await availableModRoot();
      return {
        portable: false,
        locale: effectiveLocale(),
        contentStatus: await contentStatus(),
        ...(modRoot !== undefined ? { modRoot } : {}),
      };
    },

    async pickGameFolder(): Promise<GameFolderCandidate | null> {
      const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
      if (picker !== undefined) {
        let handle: FileSystemDirectoryHandle;
        try {
          handle = await picker.call(window, { id: 'open-northland-game' });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return null;
          throw err; // a permission or read failure is not a cancel and must surface
        }
        return candidateOf(await snapshotDirectoryHandle(handle));
      }
      const files = await pickDirectoryFiles();
      if (files === null) return null;
      const folder = snapshotFileList(files);
      return folder === undefined ? null : candidateOf(folder);
    },

    async adoptFolder(folder: PickedFolder): Promise<GameFolderCandidate | null> {
      return candidateOf(folder);
    },

    async runPipeline(gamePath: string): Promise<void> {
      if (worker !== undefined) throw new Error('pipeline already running');
      if (modDownload !== undefined) throw new Error(messages().errors.modStillDownloading);
      const folder = picked;
      if (folder === undefined || folder.name !== gamePath) {
        throw new Error(messages().errors.noArchives);
      }
      const probe = await probeGameFolder(fileMapVfs(folder.files), '');
      if (!probe.hasArchives) throw new Error(messages().errors.noArchives);
      const modRoot = probe.hasMod ? undefined : await availableModRoot();
      if (!probe.hasMod && modRoot === undefined) throw new Error(messages().errors.modRequired);
      await requestPersistentStorage();
      await assertRoomForConversion();
      if (!(await holdPipelineLock())) throw new Error(messages().errors.conversionElsewhere);

      const spawned = new Worker(new URL('pipeline-worker.js', document.baseURI));
      worker = spawned;
      spawned.onmessage = (event: MessageEvent) => {
        const message = event.data as PipelineWorkerMessage;
        if (message.kind === 'done' || message.kind === 'error') stopWorker();
        for (const listener of pipelineListeners) listener(message);
      };
      spawned.onerror = (event: ErrorEvent) => {
        stopWorker();
        for (const listener of pipelineListeners) {
          listener({ kind: 'error', message: event.message || 'pipeline worker crashed' });
        }
      };
      const request: RunPipelineRequest = {
        kind: 'run',
        game: folder.files,
        modRoot,
        locale: effectiveLocale(),
      };
      spawned.postMessage(request);
    },

    async stopPipeline(): Promise<void> {
      stopWorker();
    },

    onPipelineEvent(listener: (event: PipelineEvent) => void): void {
      pipelineListeners.push(listener);
    },

    async downloadMod(): Promise<string> {
      if (modDownload !== undefined) throw new Error(messages().errors.modDownloadRunning);
      // The archive and the tree it unpacks to are the bulk of what a visitor must fit; refusing
      // here beats failing after 600 MB of download.
      await requestPersistentStorage();
      await assertRoomForConversion();
      modDownload = new AbortController();
      const { signal } = modDownload;
      try {
        const fs = await opfsRoot();
        return await withStorageMessage(() =>
          installCnMod(
            fs,
            MODS_DIR,
            async (destZip, onEvent, downloadSignal) => {
              const response = await fetch(CNMOD_ARCHIVE_URL, { signal: downloadSignal ?? null });
              if (!response.ok) {
                throw new Error(`mod download: ${CNMOD_ARCHIVE_URL.pathname} answered ${response.status}`);
              }
              return streamToOpfsFile(destZip, response, onEvent, downloadSignal);
            },
            forwardModEvent,
            { signal },
          ),
        );
      } finally {
        modDownload = undefined;
      }
    },

    async cancelModDownload(): Promise<void> {
      modDownload?.abort();
    },

    async pickModFolder(): Promise<string | null> {
      const file = await pickZipFile();
      if (file === null) return null;
      await requestPersistentStorage();
      await assertRoomForConversion();
      const fs = await opfsRoot();
      return withStorageMessage(() =>
        installCnMod(
          fs,
          MODS_DIR,
          (destZip, onEvent, signal) => streamToOpfsFile(destZip, new Response(file), onEvent, signal),
          forwardModEvent,
        ),
      );
    },

    onModEvent(listener: (event: ModEvent) => void): void {
      modListeners.push(listener);
    },

    async startGame(): Promise<void> {
      // Re-checked here, not only in the setup UI: incompatible content must never boot.
      if ((await contentStatus()) === 'stale-schema') {
        throw new Error(messages().errors.incompatibleSchema);
      }
      location.assign(`${PLAY_URL}?lang=${effectiveLocale()}`);
    },

    async setLocale(locale: Locale): Promise<void> {
      storeLocale(locale);
    },
  };
  return api;
}

/** A one-shot hidden file input; the "I already have it" affordance takes the mod zip itself. */
function pickZipFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Folder picking without `showDirectoryPicker`: a one-shot `webkitdirectory` input. */
function pickDirectoryFiles(): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.addEventListener('change', () => resolve(input.files));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
