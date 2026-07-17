import { mkdir, open, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import type { ModEvent } from '../ipc.js';
import { readZipEntries, readZipEntryData } from '../zip.js';

/** Unpacks the downloaded mod archive, refusing any member that would write outside the target dir. */

/** A zip member name (forward-slash separated) as a safe extraction-relative path, or undefined to skip. */
export function zipMemberRelPath(name: string): string | undefined {
  // A Windows drive-relative name (`C:evil`) is not absolute, so guard it explicitly.
  if (/^[A-Za-z]:/.test(name)) return undefined;
  const native = name.replace(/\//g, sep);
  const norm = normalize(native);
  if (norm === '' || norm === '.') return undefined;
  if (isAbsolute(norm) || norm === '..' || norm.startsWith(`..${sep}`)) return undefined;
  return norm;
}

/** Extracts every file member of `zipPath` under `destDir`; returns the number of files written.
 * An aborted `signal` stops between entries (the wizard's Cancel stays live while unpacking). */
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
