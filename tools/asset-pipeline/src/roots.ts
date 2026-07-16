import { access } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
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

/** Resolves `rel` overlay-first: the first root where the exact path exists, or undefined in neither. */
export async function resolveSourceFile(roots: SourceRoots, rel: string): Promise<string | undefined> {
  for (const root of rootsInOrder(roots)) {
    const path = join(root, rel);
    try {
      await access(path);
      return path;
    } catch {
      // not in this root — fall through to the next
    }
  }
  return undefined;
}

/**
 * Recursively collects every file under the roots whose lower-cased relative path satisfies `match`,
 * as a union keyed by relative path — the overlay's copy wins on a collision — sorted by `rel` so a
 * re-run is reproducible regardless of directory-entry order. A missing `game` root propagates (an
 * environmental error); the mod root's existence is the caller's contract ({@link SourceRoots}).
 */
export async function collectSourceFiles(
  roots: SourceRoots,
  match: (relLower: string) => boolean,
): Promise<SourceFile[]> {
  const byRel = new Map<string, string>();
  for (const root of rootsInOrder(roots)) {
    for await (const file of walkFiles(root)) {
      const rel = relative(root, file);
      if (!match(rel.toLowerCase()) || byRel.has(rel)) continue;
      byRel.set(rel, file);
    }
  }
  return [...byRel.entries()].map(([rel, path]) => ({ rel, path })).sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/**
 * Collects every file whose last path segment is `name` (case-insensitive) — the shared file
 * selection of the map tree-walk stages (`map.cif`, `map.dat`), overlay-aware.
 */
export async function collectSourceFilesNamed(roots: SourceRoots, name: string): Promise<SourceFile[]> {
  const suffix = `${sep}${name.toLowerCase()}`;
  return collectSourceFiles(roots, (rel) => `${sep}${rel}`.endsWith(suffix));
}
