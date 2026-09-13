import { normalizeRelPath, type Vfs, vjoin } from '@open-northland/vfs';
import { decodeLib, type LibFile } from '../decoders/lib.js';
import { errorMessage } from '../errors.js';
import type { StageItemReporter } from '../progress.js';
import { collectSourceFiles, type SourceRoots } from '../roots.js';
import { DATA_DIR, servedRelPath } from './content-tree.js';

/**
 * Maps a `.lib` member name (a backslash path like `data\engine2d\bin\bobs\ls_bridge.bmd`) to a safe
 * path relative to the extraction root, or `undefined` if it would escape it. A name that is empty,
 * absolute, drive-relative, or climbs out of the root is rejected as a defence against a malformed or
 * hostile archive.
 *
 * The leading segment folds to {@link DATA_DIR} and a member landing in a served subtree takes that
 * route's spelling ({@link servedRelPath}): the real archive stores members lowercase under `data\`
 * (all 2691 in the owned copy) while the content routes serve the exact-case `Data/` tree, and on a
 * case-sensitive filesystem the verbatim spelling would split extraction and routes into two trees.
 */
export function libMemberRelPath(name: string): string | undefined {
  const norm = normalizeRelPath(name);
  if (norm === undefined) return undefined;
  const [head, ...rest] = norm.split('/');
  if (head === undefined || head.toLowerCase() !== DATA_DIR.toLowerCase()) return norm;
  return servedRelPath(vjoin(DATA_DIR, ...rest));
}

/** One extracted archive member: the source `.lib` and the member, both relative for a stable report. */
export interface LibExtraction {
  /** The `.lib` archive's root-relative path. */
  readonly archive: string;
  /** The member's path relative to `outDir`. */
  readonly member: string;
}

/**
 * Unpacks every `.lib` archive under the source `roots`, writing each member to `outDir` under its
 * sanitized, `Data/`-canonicalized internal path ({@link libMemberRelPath}).
 *
 * A `.lib` that fails to decode is logged and skipped, as is a member with an unsafe name. Two
 * same-archive members extracting to one case-folded path throw, because a silent winner would differ
 * by host filesystem and the real archive has no such pair. An output-write failure or an unreadable
 * game root propagates as an environmental error. The whole archive is read into memory and members are
 * sliced from that single buffer through `decodeLib`'s zero-copy payload views.
 */
export async function unpackLibTree(
  fs: Vfs,
  roots: SourceRoots,
  outDir: string,
  onItem?: StageItemReporter,
): Promise<LibExtraction[]> {
  const done: LibExtraction[] = [];
  for (const { rel: archive, path: file } of await collectSourceFiles(fs, roots, (rel) =>
    rel.endsWith('.lib'),
  )) {
    let archiveBytes: Uint8Array;
    try {
      archiveBytes = await fs.readFile(file);
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
      await fs.writeFile(vjoin(outDir, rel), member.data);
      done.push({ archive, member: rel });
      onItem?.(done.length);
    }
  }
  return done;
}
