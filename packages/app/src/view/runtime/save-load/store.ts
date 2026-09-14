import type { SaveBytes } from './codec.js';

/** One listed save: the store identity plus the metadata the list UI shows; a field is null when
 *  the backing file did not yield it. */
export interface SaveSlotInfo {
  /** Store key; the browser store keys a slot by its name. */
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

/** The save list: named slots, newest first, overwritten by name. */
export interface SaveStore {
  list(): Promise<SaveSlotInfo[]>;
  read(id: string): Promise<SaveBytes | null>;
  write(name: string, bytes: SaveBytes, meta: SaveSlotMeta): Promise<void>;
  remove(id: string): Promise<void>;
}

export function newestFirst(slots: readonly SaveSlotInfo[]): SaveSlotInfo[] {
  return [...slots].sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}
