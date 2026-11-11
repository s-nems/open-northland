import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CURSOR_CONFINE_AVAILABLE_CHANNEL, SET_CURSOR_CONFINE_CHANNEL } from './cursor/channels.js';
import {
  CLEAR_FAULTS_CHANNEL,
  FAULT_VERSIONS_CHANNEL,
  PENDING_FAULTS_CHANNEL,
  PREVIOUS_RUN_CHANNEL,
} from './faults/channels.js';
import type { PreviousShellRun } from './faults/shell-run.js';
import type { ShellFault } from './faults/store.js';
import {
  CANCEL_LOCAL_MAP_PICK_CHANNEL,
  COMMIT_MAPS_CHANNEL,
  DROP_LOCAL_MAP_CHANNEL,
  LIST_MAPS_CHANNEL,
  PICK_LOCAL_MAP_CHANNEL,
  READ_MAP_CHANNEL,
  READ_MAP_FILE_CHANNEL,
  READ_MAP_SOURCE_CHANNEL,
} from './maps/channels.js';
import { ORIGINAL_GAME_STATUS_CHANNEL, PICK_ORIGINAL_GAME_CHANNEL } from './original-game/channels.js';
import type { OriginalGamePick, OriginalGameStatus } from './original-game/gate.js';
import {
  FULLSCREEN_CHANGED_CHANNEL,
  IS_FULLSCREEN_CHANNEL,
  SET_FULLSCREEN_CHANNEL,
} from './window/fullscreen-channels.js';

// The app reads the mode synchronously, so the preload mirrors it: asked once, then kept by the events.
let active = ipcRenderer.sendSync(IS_FULLSCREEN_CHANNEL) === true;
const listeners = new Set<() => void>();
ipcRenderer.on(FULLSCREEN_CHANGED_CHANNEL, (_event, next: unknown) => {
  active = next === true;
  for (const listener of listeners) listener();
});

const cursorConfine =
  ipcRenderer.sendSync(CURSOR_CONFINE_AVAILABLE_CHANNEL) === true
    ? {
        set: async (mode: unknown): Promise<void> => {
          await ipcRenderer.invoke(SET_CURSOR_CONFINE_CHANNEL, mode);
        },
      }
    : undefined;

// The shape `packages/app/src/view/platform/host.ts` declares as `window.desktop`.
contextBridge.exposeInMainWorld('desktop', {
  fullscreen: {
    isActive: (): boolean => active,
    set: async (next: unknown): Promise<void> => {
      await ipcRenderer.invoke(SET_FULLSCREEN_CHANNEL, next === true);
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  },
  ...(cursorConfine === undefined ? {} : { cursorConfine }),
  originalGame: {
    status: (): Promise<OriginalGameStatus> => ipcRenderer.invoke(ORIGINAL_GAME_STATUS_CHANNEL),
    pickFolder: (): Promise<OriginalGamePick> => ipcRenderer.invoke(PICK_ORIGINAL_GAME_CHANNEL),
  },
  maps: {
    drop: (file: File) => ipcRenderer.invoke(DROP_LOCAL_MAP_CHANNEL, webUtils.getPathForFile(file)),
    pick: (kind: unknown) => ipcRenderer.invoke(PICK_LOCAL_MAP_CHANNEL, kind),
    cancelPick: () => ipcRenderer.invoke(CANCEL_LOCAL_MAP_PICK_CHANNEL),
    readSource: (entryId: unknown) => ipcRenderer.invoke(READ_MAP_SOURCE_CHANNEL, entryId),
    list: () => ipcRenderer.invoke(LIST_MAPS_CHANNEL),
    readFile: (mapId: unknown, suffix: unknown) => ipcRenderer.invoke(READ_MAP_FILE_CHANNEL, mapId, suffix),
    readMap: (mapId: unknown) => ipcRenderer.invoke(READ_MAP_CHANNEL, mapId),
    commit: (drop: unknown, put: unknown, sources: unknown) =>
      ipcRenderer.invoke(COMMIT_MAPS_CHANNEL, drop, put, sources),
  },
  faults: {
    pending: (): Promise<ShellFault[]> => ipcRenderer.invoke(PENDING_FAULTS_CHANNEL),
    clear: async (ids: unknown): Promise<void> => {
      await ipcRenderer.invoke(CLEAR_FAULTS_CHANNEL, ids);
    },
    versions: (): Promise<Record<string, string>> => ipcRenderer.invoke(FAULT_VERSIONS_CHANNEL),
    previousRun: (): Promise<PreviousShellRun | null> => ipcRenderer.invoke(PREVIOUS_RUN_CHANNEL),
  },
});
