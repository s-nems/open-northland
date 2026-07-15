import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { decodeLib, type LibFile } from '../decoders/lib.js';
import { walkFiles } from '../walk.js';

/**
 * Maps a `.lib` member name (a backslash path like `data\engine2d\bin\bobs\ls_bridge.bmd`) to a
 * safe path relative to the extraction root, or `undefined` if it would escape it. Archive names
 * use Windows backslashes regardless of host OS, so they are rewritten to the native separator before
 * normalizing. A normalized path that is absolute or still starts with `..` (i.e. climbs out of the
 * root) is rejected — defence against a malformed/hostile archive even though the real `data0001.lib`
 * has no such entries. An empty or all-separator name yields `undefined` (nothing to write).
 */
export function libMemberRelPath(name: string): string | undefined {
  const native = name.replace(/\\/g, sep);
  const norm = normalize(native);
  if (norm === '' || norm === '.') return undefined;
  if (isAbsolute(norm) || norm === '..' || norm.startsWith(`..${sep}`)) return undefined;
  return norm;
}

/** One extracted archive member: the source `.lib` and the member, both relative for a stable report. */
export interface LibExtraction {
  /** The `.lib` archive's path relative to `gameDir`. */
  readonly archive: string;
  /** The member's path relative to `outDir` (native separators). */
  readonly member: string;
}

/**
 * Unpacks every `.lib` archive under `gameDir`, writing each member to `outDir` under its (sanitized)
 * internal path — the documented stage-1 unpack that feeds the loose-file decoders (`.pcx`/`.bmd`/
 * `.cif` embedded in `data0001.lib`). Member names use backslash paths; {@link libMemberRelPath}
 * rewrites them to native separators and drops any that would escape `outDir`.
 *
 * A `.lib` that fails to decode is logged and skipped — a batch pipeline must not abort on one corrupt
 * archive — as is an individual member with an unsafe name (warned, not written). An output-write
 * failure (and a missing/unreadable `gameDir`) propagates: that's an environmental error, not a
 * per-file boundary failure. The whole archive is read into memory; `decodeLib` returns zero-copy
 * payload views, so members are sliced from that single buffer rather than re-read.
 */
export async function unpackLibTree(gameDir: string, outDir: string): Promise<LibExtraction[]> {
  const done: LibExtraction[] = [];
  for await (const file of walkFiles(gameDir)) {
    if (!file.toLowerCase().endsWith('.lib')) continue;
    const archive = relative(gameDir, file);
    let archiveBytes: Uint8Array;
    try {
      archiveBytes = await readFile(file);
    } catch (err) {
      console.warn(`[pipeline] skipped archive ${archive}: ${(err as Error).message}`);
      continue;
    }
    let files: readonly LibFile[];
    try {
      files = decodeLib(archiveBytes).files;
    } catch (err) {
      console.warn(`[pipeline] skipped archive ${archive}: ${(err as Error).message}`);
      continue;
    }
    for (const member of files) {
      const rel = libMemberRelPath(member.name);
      if (rel === undefined) {
        console.warn(`[pipeline] skipped unsafe member "${member.name}" in ${archive}`);
        continue;
      }
      const outPath = join(outDir, rel);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, member.data);
      done.push({ archive, member: rel });
    }
  }
  return done;
}
