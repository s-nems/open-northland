import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import type { ModEvent } from '../ipc.js';
import { readZipEntries, readZipEntryData } from './zip.js';

/** A zip member name as an extraction-relative path that cannot escape the target dir (zip slip),
 *  or undefined when it would. */
export function zipMemberRelPath(name: string): string | undefined {
  // A Windows drive-relative name (`C:evil`) is not absolute, so guard it explicitly.
  if (/^[A-Za-z]:/.test(name)) return undefined;
  const native = name.replace(/\//g, sep);
  const norm = normalize(native);
  if (norm === '' || norm === '.') return undefined;
  if (isAbsolute(norm) || norm === '..' || norm.startsWith(`..${sep}`)) return undefined;
  return norm;
}

/** Extracts every file member of `zipPath` under `destDir` and returns the number written. An
 *  aborted `signal` stops between entries. */
export async function extractModZip(
  zipPath: string,
  destDir: string,
  onEvent: (event: ModEvent) => void,
  signal?: AbortSignal,
): Promise<number> {
  const fh = await open(zipPath, 'r');
  try {
    const fileSize = (await stat(zipPath)).size;
    const entries = (await readZipEntries(fh, fileSize)).filter((e) => !e.name.endsWith('/'));
    let done = 0;
    for (const entry of entries) {
      signal?.throwIfAborted();
      const rel = zipMemberRelPath(entry.name);
      if (rel === undefined) {
        onEvent({ kind: 'mod-warning', message: `skipped unsafe zip member "${entry.name}"` });
        continue;
      }
      const outPath = join(destDir, rel);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, await readZipEntryData(fh, entry, fileSize));
      done++;
      onEvent({ kind: 'mod-extract', done, total: entries.length });
    }
    return done;
  } finally {
    await fh.close();
  }
}
