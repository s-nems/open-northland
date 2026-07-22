import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { CULTURESNATION_MOD } from './probe.js';
import { walkFiles } from './walk.js';

/**
 * The read-only source trees one conversion reads: the owned base install plus the culturesnation
 * mod overlay — a directory shaped like the game root (e.g. the unpacked CnMod zip, which ships
 * `DataCnmd/`, `CnModMaps/`, and patched `Data/`/`DataX/` files). A file present in the overlay wins
 * over the base game's copy on the same relative path, matching what an install with the mod
 * extracted over it would contain. `mod === game` is that installed-in-place layout: the overlay is
 * the identity and every path resolves against the one tree.
 */
export interface SourceRoots {
  readonly game: string;
  readonly mod: string | undefined;
}

/** One source file found under the roots: its root-relative path and the winning absolute path. */
export interface SourceFile {
  readonly rel: string;
  readonly path: string;
}

/** The roots in resolution order (mod overlay first), collapsed when the overlay is absent or identity. */
export function rootsInOrder(roots: SourceRoots): readonly string[] {
  return roots.mod === undefined || roots.mod === roots.game ? [roots.game] : [roots.mod, roots.game];
}

/**
 * The unpacked-archive tree addressed as a one-root `SourceRoots`: the archive layer for stages that
 * re-read extracted `.lib` members from `out`. Which layer should win a loose/archive collision is
 * unobserved in the original; each call site keeps its current order.
 */
export function archiveRoots(outDir: string): SourceRoots {
  return { game: outDir, mod: undefined };
}

/**
 * Picks the directory entry that case-folds to `segment`: the exact spelling when present, else the
 * single folded match. Two folded matches with no exact one are a same-layer case collision this
 * policy refuses to order (only a case-sensitive filesystem can host such twins). Undefined when
 * nothing matches.
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
 * Resolves `segments` under `dir`, matching each path segment case-insensitively
 * ({@link pickCaseFoldedEntry}), and returns the real-cased on-disk path, or undefined when any
 * segment is absent. The shipped trees mix casing freely (`Text/`, `TEXT/`, `Pol/`, `Strings.ini`
 * all ship), which a case-insensitive macOS/Windows filesystem hides but a case-sensitive Linux one
 * does not; resolving via directory listings keeps every stage portable.
 */
export async function findPathCaseInsensitive(
  dir: string,
  segments: readonly string[],
): Promise<string | undefined> {
  let current = dir;
  for (const segment of segments) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return undefined; // `current` missing or not a directory - the path does not resolve
    }
    const match = pickCaseFoldedEntry(entries, segment, current);
    if (match === undefined) return undefined;
    current = join(current, match);
  }
  return current;
}

/** {@link findPathCaseInsensitive} over candidate directories in priority order - the first that resolves wins. */
export async function findPathCaseInsensitiveInDirs(
  dirs: readonly string[],
  segments: readonly string[],
): Promise<string | undefined> {
  for (const dir of dirs) {
    const path = await findPathCaseInsensitive(dir, segments);
    if (path !== undefined) return path;
  }
  return undefined;
}

/**
 * Resolves `rel` overlay-first: the first root where the path resolves case-insensitively
 * ({@link findPathCaseInsensitive}), or undefined in neither. The pipeline's one source-path rule;
 * every loose-file read resolves through this.
 */
export async function resolveSourceFile(roots: SourceRoots, rel: string): Promise<string | undefined> {
  return findPathCaseInsensitiveInDirs(rootsInOrder(roots), rel.split(sep));
}

/** One root's walked files, before the cross-root union. */
interface RootFiles {
  readonly root: string;
  readonly files: readonly { readonly rel: string; readonly path: string }[];
}

/**
 * Merges per-root listings into one union keyed by the case-folded relative path, an earlier root
 * winning a collision even when the trees spell the path with different case (an over-install on the
 * original's case-insensitive targets would have merged such paths into one file). Two same-root
 * paths that fold equal have no such merged identity and throw instead of silently ordering. Sorted
 * by `rel` so a re-run is reproducible regardless of directory-entry order.
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
 * as an overlay-first case-folded union ({@link unionCaseFoldedRoots}). A missing `game` root
 * propagates (an environmental error); the mod root's existence is the caller's contract
 * ({@link SourceRoots}).
 */
export async function collectSourceFiles(
  roots: SourceRoots,
  match: (relLower: string) => boolean,
): Promise<SourceFile[]> {
  const perRoot: RootFiles[] = [];
  for (const root of rootsInOrder(roots)) {
    const files: { rel: string; path: string }[] = [];
    for await (const file of walkFiles(root)) {
      const rel = relative(root, file);
      if (match(rel.toLowerCase())) files.push({ rel, path: file });
    }
    perRoot.push({ root, files });
  }
  return unionCaseFoldedRoots(perRoot);
}

/**
 * Collects every file whose last path segment is `name` (case-insensitive) — the shared file
 * selection of the map tree-walk stages (`map.cif`, `map.dat`), overlay-aware.
 */
export async function collectSourceFilesNamed(roots: SourceRoots, name: string): Promise<SourceFile[]> {
  const suffix = `${sep}${name.toLowerCase()}`;
  return collectSourceFiles(roots, (rel) => `${sep}${rel}`.endsWith(suffix));
}

/** Where players get the culturesnation mod — named in the fail-fast error and the installer UI. */
export const CULTURESNATION_HOME_URL = 'https://culturesnation.pl/news.php';

/**
 * Resolves the mod overlay root the conversion reads from: an explicit `modRoot` must contain a
 * `DataCnmd/` directory; with none given, a game folder that contains one (the mod installed in
 * place) is its own overlay. No mod anywhere fails fast here — a mod-less conversion would
 * otherwise die deep in IR cross-reference validation (the tribe/weapon/house tables are readable
 * only under `DataCnmd/`) with an error nobody can act on.
 */
export async function resolveModRoot(game: string, modRoot: string | undefined): Promise<string> {
  const hasMod = async (root: string): Promise<boolean> => {
    try {
      return (await stat(join(root, CULTURESNATION_MOD))).isDirectory();
    } catch {
      return false;
    }
  };
  if (modRoot !== undefined) {
    if (await hasMod(modRoot)) return modRoot;
    throw new Error(
      `--mod-root ${modRoot} has no ${CULTURESNATION_MOD}/ — point it at the unpacked culturesnation ` +
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
