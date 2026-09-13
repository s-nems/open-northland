import type { SaveBytes } from './codec.js';
import { browserSaveStore } from './store-browser.js';
import { desktopSaveListBridge, desktopSaveStore } from './store-desktop.js';

/** One listed save: the store identity plus the metadata the list UI shows; a field is null when
 *  the backing file did not yield it. */
export interface SaveSlotInfo {
  /** Opaque store key: the display name in the browser store, the file basename on desktop. */
  readonly id: string;
  readonly name: string;
  readonly mapId: string | null;
  readonly tick: number | null;
  readonly entry: string | null;
  /** Milliseconds since the epoch. */
  readonly savedAt: number | null;
}

/** Header provenance recorded at write time where the backing store cannot re-read it cheaply. */
export interface SaveSlotMeta {
  readonly savedAt?: number | null;
  readonly mapId: string | null;
  readonly tick: number;
  readonly entry: string | null;
}

/** The save list every platform shows: named slots, newest first, overwritten by name. */
export interface SaveStore {
  list(): Promise<SaveSlotInfo[]>;
  read(id: string): Promise<SaveBytes | null>;
  write(name: string, bytes: SaveBytes, meta: SaveSlotMeta): Promise<void>;
  remove(id: string): Promise<void>;
  /** Reveal the backing folder in the OS file manager; null where no such folder exists. */
  readonly showFolder: (() => Promise<void>) | null;
}

/** The platform's save store: the desktop saves folder over IPC, else the browser's IndexedDB. */
export function createSaveStore(): SaveStore {
  const bridge = desktopSaveListBridge();
  return bridge !== null ? desktopSaveStore(bridge) : browserSaveStore();
}

export function newestFirst(slots: readonly SaveSlotInfo[]): SaveSlotInfo[] {
  return [...slots].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}
