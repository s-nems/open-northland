import { normalizeRelPath, type Vfs, vjoin } from '@open-northland/vfs';
import type { ModEvent } from '../shell-api.js';
import { readZipEntries, readZipEntryData, vfsZipSource } from './zip.js';

/** A zip member name as an extraction-relative path that cannot escape the target dir (zip slip),
 *  or undefined when it would. */
export function zipMemberRelPath(name: string): string | undefined {
  return normalizeRelPath(name);
}

/** Extracts every file member of `zipPath` under `destDir` and returns the number written. An
 *  aborted `signal` stops between entries. */
export async function extractModZip(
  fs: Vfs,
  zipPath: string,
  destDir: string,
  onEvent: (event: ModEvent) => void,
  signal?: AbortSignal,
): Promise<number> {
  const source = await vfsZipSource(fs, zipPath);
  const entries = (await readZipEntries(source)).filter((e) => !e.name.endsWith('/'));
  let done = 0;
  for (const entry of entries) {
    signal?.throwIfAborted();
    const rel = zipMemberRelPath(entry.name);
    if (rel === undefined) {
      onEvent({ kind: 'mod-warning', message: `skipped unsafe zip member "${entry.name}"` });
      continue;
    }
    await fs.writeFile(vjoin(destDir, rel), await readZipEntryData(source, entry));
    done++;
    onEvent({ kind: 'mod-extract', done, total: entries.length });
  }
  return done;
}
