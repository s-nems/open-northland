import type { ReadableVfs } from '@open-northland/vfs';

/**
 * The file names directly under `dir`. An index built from this set answers "is there a sidecar"
 * without a `stat` per candidate, which on the service worker's OPFS adapter costs a directory walk
 * and a file materialization each.
 */
export async function fileNamesIn(fs: ReadableVfs, dir: string): Promise<ReadonlySet<string>> {
  const entries = await fs.readdir(dir);
  return new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.name));
}

/** Code-unit order, so Node, Electron, and a browser service worker list one directory identically;
 *  ICU collation does not agree across them. */
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
