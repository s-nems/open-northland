import { CULTURESNATION_MOD } from '@open-northland/asset-pipeline/probe';
import { normalizeRelPath, type Vfs, vjoin } from '@open-northland/vfs';
import type { ModEvent } from '../shell-api.js';
import type { ZipEntry, ZipSource } from './zip.js';
import { readZipEntryData } from './zip.js';

/** A zip member name as an extraction-relative path that cannot escape the target dir (zip slip),
 *  or undefined when it would. Archives store `\`-separated names too. */
export function zipMemberRelPath(name: string): string | undefined {
  return normalizeRelPath(name);
}

/** Where the mod sits inside an archive: the member-name prefix of the directory holding
 *  `DataCnmd/`, empty when it sits at the archive root, and the folder name to install it under. */
export interface ModArchiveLayout {
  readonly prefix: string;
  readonly name: string;
}

/** Folder name for a mod root the archive did not wrap in its own `CnMod <version>/` dir. */
const UNWRAPPED_MOD_DIR_NAME = 'CnMod';

function depthOf(prefix: string): number {
  return prefix === '' ? 0 : prefix.split('/').length;
}

/**
 * The shallowest mod root in the archive, matched on normalized member names so that separator and
 * `./` spellings resolve alike. The spelling of `DataCnmd` must match exactly: the installed tree is
 * later found by `findModRootUnder`, which stats that name on a file system that may be
 * case-sensitive.
 */
export function modLayoutOf(entries: readonly ZipEntry[]): ModArchiveLayout | undefined {
  const marker = `/${CULTURESNATION_MOD}/`;
  let best: string | undefined;
  for (const entry of entries) {
    const rel = zipMemberRelPath(entry.name);
    if (rel === undefined) continue;
    const at = `/${rel}`.indexOf(marker);
    if (at < 0) continue;
    const prefix = at === 0 ? '' : rel.slice(0, at - 1);
    if (
      best === undefined ||
      depthOf(prefix) < depthOf(best) ||
      (depthOf(prefix) === depthOf(best) && prefix < best)
    ) {
      best = prefix;
    }
  }
  if (best === undefined) return undefined;
  const name = best === '' ? UNWRAPPED_MOD_DIR_NAME : (best.split('/').pop() ?? UNWRAPPED_MOD_DIR_NAME);
  return { prefix: best, name };
}

export interface ModExtraction {
  readonly source: ZipSource;
  readonly entries: readonly ZipEntry[];
  readonly layout: ModArchiveLayout;
  readonly destDir: string;
}

/** Directory members carry no bytes and are created implicitly. Both separators end one, and
 *  `normalizeRelPath` drops the trailing one, so this has to run on the raw name. */
function isDirectoryMember(entry: ZipEntry): boolean {
  return /[\\/]$/.test(entry.name);
}

/** Writes every member under the layout's prefix into `destDir`, prefix stripped, and returns the
 *  number written. An aborted `signal` stops between entries. */
export async function extractModEntries(
  fs: Vfs,
  extraction: ModExtraction,
  onEvent: (event: ModEvent) => void,
  signal?: AbortSignal,
): Promise<number> {
  const { source, entries, layout, destDir } = extraction;
  const prefix = layout.prefix === '' ? '' : `${layout.prefix}/`;
  const members: { readonly entry: ZipEntry; readonly rel: string }[] = [];
  for (const entry of entries) {
    if (isDirectoryMember(entry)) continue;
    const rel = zipMemberRelPath(entry.name);
    if (rel === undefined) {
      onEvent({ kind: 'mod-warning', message: `skipped unsafe zip member "${entry.name}"` });
      continue;
    }
    if (rel.startsWith(prefix) && rel.length > prefix.length) {
      members.push({ entry, rel: rel.slice(prefix.length) });
    }
  }
  let done = 0;
  for (const { entry, rel } of members) {
    signal?.throwIfAborted();
    await fs.writeFile(vjoin(destDir, rel), await readZipEntryData(source, entry));
    done++;
    onEvent({ kind: 'mod-extract', done, total: members.length });
  }
  return done;
}
