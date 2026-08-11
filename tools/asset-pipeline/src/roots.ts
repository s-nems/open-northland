import { type ReadableVfs, relIn, vjoin } from '@open-northland/vfs';
import { CULTURESNATION_MOD } from './probe.js';
import { walkFiles } from './walk.js';

/**
 * The source trees one conversion reads, highest precedence first: the culturesnation mod overlay, the
 * owned base install, then the unpacked-archive layer. A file in an earlier layer wins the same
 * relative path, matching an install with the mod extracted over it. `mod === game` is that
 * installed-in-place layout.
 */
export interface SourceRoots {
  readonly game: string;
  readonly mod: string | undefined;
  /** The `.lib` members unpacked under `--out`; absent until the unpack stage has run. */
  readonly archive?: string | undefined;
}

/** One source file found under the roots: its root-relative path and the winning absolute path. */
export interface SourceFile {
  readonly rel: string;
  readonly path: string;
}

/** The roots in resolution order, deduplicated - an absent or identity layer collapses away. */
export function rootsInOrder(roots: SourceRoots): readonly string[] {
  const layers = [roots.mod, roots.game, roots.archive].filter((r) => r !== undefined);
  return [...new Set(layers)];
}

/**
 * Adds the unpacked-archive tree under `outDir` as the lowest-precedence layer, so a loose file wins a
 * path collision with its `.lib` twin. Source basis: data consistency, docs/SOURCES.md "Source
 * precedence".
 */
export function withArchiveLayer(roots: SourceRoots, outDir: string): SourceRoots {
  return { ...roots, archive: outDir };
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

/** Case-insensitive resolution across candidate directories in priority order; the first hit wins. */
export async function findPathCaseInsensitiveInDirs(
  fs: ReadableVfs,
  dirs: readonly string[],
  segments: readonly string[],
): Promise<string | undefined> {
  for (const dir of dirs) {
    const path = await findPathCaseInsensitive(fs, dir, segments);
    if (path !== undefined) return path;
  }
  return undefined;
}

/**
 * Resolves `rel` overlay-first: the first root where the path resolves case-insensitively, or
 * undefined when none does. Splits on either separator, since callers pass either a joined constant
 * or an ini-borne reference already forward-slashed by `normalizeAssetPath`.
 */
export async function resolveSourceFile(
  fs: ReadableVfs,
  roots: SourceRoots,
  rel: string,
): Promise<string | undefined> {
  return findPathCaseInsensitiveInDirs(fs, rootsInOrder(roots), rel.split(/[\\/]+/));
}

/** One root's walked files, before the cross-root union. */
interface RootFiles {
  readonly root: string;
  readonly files: readonly { readonly rel: string; readonly path: string }[];
}

/**
 * Merges per-root listings into one union keyed by the case-folded relative path, an earlier root
 * winning a collision even when the trees spell the path with different case. Two same-root paths
 * that fold equal throw instead. Sorted by `rel` so a re-run is reproducible regardless of
 * directory-entry order.
 */
export function unionCaseFoldedRoots(perRoot: readonly RootFiles[]): SourceFile[] {
  const byKey = new Map<string, SourceFile>();
  for (const { root, files } of perRoot) {
    const own = new Map<string, string>();
    for (const { rel, path } of files) {
      const key = rel.toLowerCase();
      const twin = own.get(key);
      if (twin !== undefined) {
        throw new Error(
          `case-colliding sources "${twin}" and "${rel}" under ${root} - two on-disk spellings ` +
            'of one source path; remove or rename one and re-run',
        );
      }
      own.set(key, rel);
      if (!byKey.has(key)) byKey.set(key, { rel, path });
    }
  }
  return [...byKey.values()].sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/**
 * Recursively collects every file under the roots whose lower-cased relative path satisfies `match`,
 * as a layer-ordered case-folded union. A missing root propagates as an environmental error.
 */
export async function collectSourceFiles(
  fs: ReadableVfs,
  roots: SourceRoots,
  match: (relLower: string) => boolean,
): Promise<SourceFile[]> {
  const perRoot: RootFiles[] = [];
  for (const root of rootsInOrder(roots)) {
    const files: { rel: string; path: string }[] = [];
    for await (const file of walkFiles(fs, root)) {
      const rel = relIn(root, file);
      if (match(rel.toLowerCase())) files.push({ rel, path: file });
    }
    perRoot.push({ root, files });
  }
  return unionCaseFoldedRoots(perRoot);
}

/** Collects every file whose last path segment is `name`, case-insensitively, across the roots. */
export async function collectSourceFilesNamed(
  fs: ReadableVfs,
  roots: SourceRoots,
  name: string,
): Promise<SourceFile[]> {
  const suffix = `/${name.toLowerCase()}`;
  return collectSourceFiles(fs, roots, (rel) => `/${rel}`.endsWith(suffix));
}

/** Where players download the culturesnation mod. */
export const CULTURESNATION_HOME_URL = 'https://culturesnation.pl/news.php';

/**
 * Resolves the mod overlay root: an explicit `modRoot` must contain a `DataCnmd/` directory, and with
 * none given a game folder that contains one is its own overlay. No mod anywhere fails fast here,
 * because the tribe/weapon/house tables are readable only under `DataCnmd/`.
 */
export async function resolveModRoot(
  fs: ReadableVfs,
  game: string,
  modRoot: string | undefined,
): Promise<string> {
  const hasMod = async (root: string): Promise<boolean> =>
    (await fs.stat(vjoin(root, CULTURESNATION_MOD)))?.kind === 'dir';
  if (modRoot !== undefined) {
    if (await hasMod(modRoot)) return modRoot;
    throw new Error(
      `--mod-root ${modRoot} has no ${CULTURESNATION_MOD}/ - point it at the unpacked culturesnation ` +
        'mod folder (the directory that contains DataCnmd/ and CnModMaps/).',
    );
  }
  if (await hasMod(game)) return game;
  throw new Error(
    `the culturesnation mod is required and was not found: ${game} has no ${CULTURESNATION_MOD}/ and ` +
      `no --mod-root was given. Download the mod from ${CULTURESNATION_HOME_URL}, unpack it, and pass ` +
      '--mod-root <unpacked dir> (or install it into the game folder).',
  );
}
