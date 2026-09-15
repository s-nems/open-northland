import { type ReadableVfs, relIn, vjoin } from '@open-northland/vfs';
import { CULTURESNATION_HOME_URL, CULTURESNATION_MOD } from './mod-root.js';
import { walkFiles } from './walk.js';

/** The mod subtrees the stages read by name; the on-disk spelling varies, so resolve them through
 *  `resolveSourceFile` or match them lower-cased. */
export const MOD_BOBS_DIR = 'Data/engine2d/bin/bobs';
export const MOD_TEXTURES_DIR = 'Data/engine2d/bin/textures';
export const MOD_SOUNDS_DIR = 'Data/engine2d/bin/sounds';
export const MOD_GUI_BITMAPS_DIR = 'Data/gui/bitmaps';

/** The source tree one conversion reads: the unpacked culturesnation mod. */
export interface SourceRoots {
  readonly mod: string;
  /** Caller-supplied release label, not inferred from installation folder or executable. */
  readonly modVersion?: string | undefined;
}

/** One source file found under the root: its root-relative path and its absolute path. */
export interface SourceFile {
  readonly rel: string;
  readonly path: string;
}

/**
 * Picks the directory entry that case-folds to `segment`: the exact spelling when present, else the
 * single folded match. Two folded matches with no exact one throw instead of being ordered
 * arbitrarily; undefined when nothing matches.
 */
export function pickCaseFoldedEntry(
  entries: readonly string[],
  segment: string,
  where: string,
): string | undefined {
  const folded = segment.toLowerCase();
  const matches = entries.filter((e) => e.toLowerCase() === folded);
  if (matches.includes(segment)) return segment;
  const [first, second] = matches;
  if (second !== undefined) {
    throw new Error(
      `case-colliding entries "${[...matches].sort().join('", "')}" for ${segment} in ${where}`,
    );
  }
  return first;
}

/**
 * Resolves `segments` under `dir` matching each segment case-insensitively, returning the real-cased
 * on-disk path. The shipped trees mix casing freely (`Text/`, `TEXT/`, `Pol/`, `Strings.ini`), which a
 * case-insensitive macOS/Windows filesystem hides and a case-sensitive Linux one does not.
 */
export async function findPathCaseInsensitive(
  fs: ReadableVfs,
  dir: string,
  segments: readonly string[],
): Promise<string | undefined> {
  let current = dir;
  for (const segment of segments) {
    let entries: string[];
    try {
      entries = (await fs.readdir(current)).map((e) => e.name);
    } catch {
      return undefined; // `current` missing or not a directory - the path does not resolve
    }
    const match = pickCaseFoldedEntry(entries, segment, current);
    if (match === undefined) return undefined;
    current = vjoin(current, match);
  }
  return current;
}

/**
 * Resolves `rel` under the mod root case-insensitively, or undefined when it does not exist. Splits
 * on either separator, since callers pass either a joined constant or an ini-borne reference already
 * forward-slashed by `normalizeAssetPath`.
 */
export async function resolveSourceFile(
  fs: ReadableVfs,
  roots: SourceRoots,
  rel: string,
): Promise<string | undefined> {
  return findPathCaseInsensitive(fs, roots.mod, rel.split(/[\\/]+/));
}

/**
 * Recursively collects every file under the mod root whose lower-cased relative path satisfies
 * `match`. Two paths that fold equal throw, since a case-insensitive filesystem could serve either.
 * Sorted by `rel` so a re-run is reproducible regardless of directory-entry order. A missing root
 * propagates as an environmental error.
 */
export async function collectSourceFiles(
  fs: ReadableVfs,
  roots: SourceRoots,
  match: (relLower: string) => boolean,
): Promise<SourceFile[]> {
  const byKey = new Map<string, SourceFile>();
  for await (const path of walkFiles(fs, roots.mod)) {
    const rel = relIn(roots.mod, path);
    const key = rel.toLowerCase();
    if (!match(key)) continue;
    const twin = byKey.get(key);
    if (twin !== undefined) {
      throw new Error(
        `case-colliding sources "${twin.rel}" and "${rel}" under ${roots.mod} - two on-disk ` +
          'spellings of one source path; remove or rename one and re-run',
      );
    }
    byKey.set(key, { rel, path });
  }
  return [...byKey.values()].sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/** Collects every file whose last path segment is `name`, case-insensitively. */
export async function collectSourceFilesNamed(
  fs: ReadableVfs,
  roots: SourceRoots,
  name: string,
): Promise<SourceFile[]> {
  const suffix = `/${name.toLowerCase()}`;
  return collectSourceFiles(fs, roots, (rel) => `/${rel}`.endsWith(suffix));
}

/**
 * Validates the mod root, the conversion's only input: it must contain a `DataCnmd/` directory,
 * because the tribe/weapon/house tables are readable only there.
 */
export async function resolveModRoot(fs: ReadableVfs, modRoot: string): Promise<string> {
  if ((await fs.stat(vjoin(modRoot, CULTURESNATION_MOD)))?.kind === 'dir') return modRoot;
  throw new Error(
    `--mod-root ${modRoot} has no ${CULTURESNATION_MOD}/ - point it at the unpacked culturesnation ` +
      `mod (the directory that contains DataCnmd/ and CnModMaps/), downloaded from ` +
      `${CULTURESNATION_HOME_URL}. A game folder with the mod installed inside it works too.`,
  );
}
