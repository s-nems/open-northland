import { isSaveBytes, type SaveBytes } from './codec.js';
import { peekSaveHeader } from './header-peek.js';
import { displayNameOf } from './list-model.js';
import { newestFirst, type SaveSlotInfo, type SaveStore } from './store.js';

/** One save file as the desktop main process lists it: the basename, the file mtime, and the
 *  leading bytes for the renderer's header peek. */
export interface ListedSaveFile {
  readonly file: string;
  readonly savedAt: number;
  readonly prefix: Uint8Array;
}

/** The saves-folder operations a desktop preload adds beside the two file dialogs; the app reads
 *  them structurally, and `packages/desktop/src/ipc.ts` implements the same shape. */
export interface SaveListBridge {
  listSaves(): Promise<ListedSaveFile[]>;
  readSave(file: string): Promise<Uint8Array | null>;
  /** Writes `<name>.json.gz` into the saves folder, overwriting a same-named save. */
  writeSave(name: string, bytes: Uint8Array): Promise<void>;
  deleteSave(file: string): Promise<void>;
  showSavesFolder(): Promise<void>;
}

/** The desktop shell's save list bridge, or null in a plain browser. */
export function desktopSaveListBridge(): SaveListBridge | null {
  return window.desktop ?? null;
}

/** The saves folder as a store: metadata comes from each file's own header and mtime, so a file
 *  dropped into the folder by hand lists like any other save. */
export function desktopSaveStore(bridge: SaveListBridge): SaveStore {
  return {
    async list(): Promise<SaveSlotInfo[]> {
      const files = await bridge.listSaves();
      // `Foo.json` beside `Foo.json.gz` strips to one title. The writer only ever produces the
      // second, so the shadowed file keeps its full name instead of listing as a twin.
      const titles = new Map<string, number>();
      for (const entry of files) {
        const title = displayNameOf(entry.file);
        titles.set(title, (titles.get(title) ?? 0) + 1);
      }
      const slots = await Promise.all(
        files.map(async (entry): Promise<SaveSlotInfo> => {
          const peeked = isSaveBytes(entry.prefix) ? await peekSaveHeader(entry.prefix) : null;
          const title = displayNameOf(entry.file);
          return {
            id: entry.file,
            name: (titles.get(title) ?? 0) > 1 ? entry.file : title,
            mapId: peeked?.mapId ?? null,
            tick: peeked?.tick ?? null,
            entry: peeked?.entry ?? null,
            savedAt: peeked?.savedAt ?? entry.savedAt,
          };
        }),
      );
      return newestFirst(slots);
    },

    async read(id: string): Promise<SaveBytes | null> {
      const bytes = await bridge.readSave(id);
      return bytes !== null && isSaveBytes(bytes) ? bytes : null;
    },

    // The file itself carries the metadata; the store contract's `meta` is for storeless backends.
    write: (name, bytes) => bridge.writeSave(name, bytes),

    remove: (id) => bridge.deleteSave(id),

    showFolder: () => bridge.showSavesFolder(),
  };
}
