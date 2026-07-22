import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { decodeLib, type LibFile } from '../decoders/lib.js';
import { errorMessage } from '../errors.js';
import type { StageItemReporter } from '../progress.js';
import { collectSourceFiles, type SourceRoots } from '../roots.js';
import { DATA_DIR } from './content-tree.js';

/**
 * Maps a `.lib` member name (a backslash path like `data\engine2d\bin\bobs\ls_bridge.bmd`) to a
 * safe path relative to the extraction root, or `undefined` if it would escape it. Archive names
 * use Windows backslashes regardless of host OS, so they are rewritten to the native separator before
 * normalizing. A normalized path that is absolute or still starts with `..` (i.e. climbs out of the
 * root) is rejected — defence against a malformed/hostile archive even though the real `data0001.lib`
 * has no such entries. An empty or all-separator name yields `undefined` (nothing to write).
 *
 * The leading segment folds to {@link DATA_DIR}: the real archive stores members lowercase under
 * `data\` (all 2691 in the owned copy), the content routes serve the exact-case `Data/` tree, and on
 * a case-sensitive filesystem the verbatim spelling would split extraction and routes into two trees.
 */
export function libMemberRelPath(name: string): string | undefined {
  const native = name.replace(/\\/g, sep);
  const norm = normalize(native);
  if (norm === '' || norm === '.') return undefined;
  if (isAbsolute(norm) || norm === '..' || norm.startsWith(`..${sep}`)) return undefined;
  const [head, ...rest] = norm.split(sep);
  if (head === undefined || head.toLowerCase() !== DATA_DIR.toLowerCase()) return norm;
  return join(DATA_DIR, ...rest);
}

/** One extracted archive member: the source `.lib` and the member, both relative for a stable report. */
export interface LibExtraction {
  /** The `.lib` archive's root-relative path. */
  readonly archive: string;
  /** The member's path relative to `outDir` (native separators). */
  readonly member: string;
}

/**
 * Unpacks every `.lib` archive under the source `roots` (overlay-first union), writing each member to
 * `outDir` under its sanitized, `Data/`-canonicalized internal path — the documented stage-1 unpack that feeds the
 * loose-file decoders (`.pcx`/`.bmd`/`.cif` embedded in `data0001.lib`). Member names use backslash
 * paths; {@link libMemberRelPath} rewrites them to native separators and drops any that would escape
 * `outDir`.
 *
 * A `.lib` that fails to decode is logged and skipped — a batch pipeline must not abort on one corrupt
 * archive — as is an individual member with an unsafe name (warned, not written). Two same-archive
 * members extracting to one case-folded path throw: a silent winner would differ by host filesystem,
 * and the real archive has no such pair. An output-write failure (and a missing/unreadable game root)
 * propagates: that's an environmental error, not a per-file boundary failure. The whole archive is
 * read into memory; `decodeLib` returns zero-copy payload views, so members are sliced from that
 * single buffer rather than re-read.
 */
export async function unpackLibTree(
  roots: SourceRoots,
  outDir: string,
  onItem?: StageItemReporter,
): Promise<LibExtraction[]> {
  const done: LibExtraction[] = [];
  for (const { rel: archive, path: file } of await collectSourceFiles(roots, (rel) => rel.endsWith('.lib'))) {
    let archiveBytes: Uint8Array;
    try {
      archiveBytes = await readFile(file);
    } catch (err) {
      console.warn(`[pipeline] skipped archive ${archive}: ${errorMessage(err)}`);
      continue;
    }
    let files: readonly LibFile[];
    try {
      files = decodeLib(archiveBytes).files;
    } catch (err) {
      console.warn(`[pipeline] skipped archive ${archive}: ${errorMessage(err)}`);
      continue;
    }
    const seen = new Map<string, string>();
    for (const member of files) {
      const rel = libMemberRelPath(member.name);
      if (rel === undefined) {
        console.warn(`[pipeline] skipped unsafe member "${member.name}" in ${archive}`);
        continue;
      }
      // Per-archive map, so a later archive still overwrites an earlier one's extracted path.
      const twin = seen.get(rel.toLowerCase());
      if (twin !== undefined) {
        throw new Error(`colliding members "${twin}" and "${member.name}" in ${archive} extract to one path`);
      }
      seen.set(rel.toLowerCase(), member.name);
      const outPath = join(outDir, rel);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, member.data);
      done.push({ archive, member: rel });
      onItem?.(done.length);
    }
  }
  return done;
}
