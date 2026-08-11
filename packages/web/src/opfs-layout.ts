import { type Vfs, vjoin } from '@open-northland/vfs';
import { opfsVfs } from '@open-northland/vfs/opfs';

/** The web shell's data root inside the origin-private file system. */
export const DATA_DIR = 'open-northland';

export const CONTENT_DIR = vjoin(DATA_DIR, 'content');
export const MODS_DIR = vjoin(DATA_DIR, 'mods');

/** The whole origin-private file system as a Vfs; layout paths above are relative to it. */
export async function opfsRoot(): Promise<Vfs> {
  return opfsVfs(await navigator.storage.getDirectory());
}
