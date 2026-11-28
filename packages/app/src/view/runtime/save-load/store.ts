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
  /** The world seed: a new game draws one and every save of that game keeps it, so with `mapId` it
   *  names the playthrough. */
  readonly seed: number | null;
  /** A small picture of the world as it stood, when one was taken. */
  readonly thumbnail: Blob | null;
  /** The game version the slot was written on; null when the store records none. */
  readonly version?: string | null;
  /** The build the slot was written on, which decides whether this build can play it; null when the
   *  store records none. */
  readonly clientBuild?: string | null;
}

/** The save header's provenance, recorded beside the bytes so a list never inflates a save. */
export interface SaveSlotMeta {
  readonly savedAt: number | null;
  readonly mapId: string | null;
  readonly tick: number;
  readonly entry: string | null;
  readonly seed: number;
  readonly thumbnail: Blob | null;
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
