import { type Vfs, type VfsEntry, vjoin } from '@open-northland/vfs';

/**
 * Cheap validation of a user-picked original-game folder for installer UIs. An owned install is
 * recognized by its `.lib` archives (the real copy ships `DataX/Libs/data0001.lib`); `DataCnmd/`
 * marks the culturesnation mod whose readable `.ini` sources the pipeline prefers.
 */

/** How deep the probe scans for a `.lib`; the known archive sits at depth 3. */
const PROBE_MAX_DEPTH = 4;

export interface GameFolderProbe {
  /** At least one `.lib` archive within the depth bound; the minimum the unpack stage needs. */
  readonly hasArchives: boolean;
  /** Whether `DataCnmd/` is present in place; if not, the conversion needs an external `--mod-root`. */
  readonly hasMod: boolean;
}

/** The directory that marks a culturesnation mod root - inside the game folder or an unpacked copy. */
export const CULTURESNATION_MOD = 'DataCnmd';

/**
 * Probes `dir` as a game-folder candidate with a bounded breadth-first scan, never a full-tree walk,
 * so a wrong pick like the user's home directory stays cheap. Unreadable directories count as empty.
 */
export async function probeGameFolder(fs: Vfs, dir: string): Promise<GameFolderProbe> {
  let top: VfsEntry[];
  try {
    top = await fs.readdir(dir);
  } catch {
    return { hasArchives: false, hasMod: false };
  }
  const hasMod = top.some((e) => e.kind === 'dir' && e.name === CULTURESNATION_MOD);
  const scan = (parent: string, entries: readonly VfsEntry[], next: string[]): boolean => {
    for (const entry of entries) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.lib')) return true;
      if (entry.kind === 'dir' && !entry.name.startsWith('.')) next.push(vjoin(parent, entry.name));
    }
    return false;
  };
  let level: string[] = [];
  if (scan(dir, top, level)) return { hasArchives: true, hasMod };
  for (let depth = 1; depth < PROBE_MAX_DEPTH && level.length > 0; depth++) {
    const next: string[] = [];
    for (const current of level) {
      let entries: VfsEntry[];
      try {
        entries = await fs.readdir(current);
      } catch {
        continue;
      }
      if (scan(current, entries, next)) return { hasArchives: true, hasMod };
    }
    level = next;
  }
  return { hasArchives: false, hasMod };
}
