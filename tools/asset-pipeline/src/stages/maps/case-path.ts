import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Resolves `segments` under `dir`, matching each path segment case-insensitively, and returns the
 * on-disk path or null when any segment is absent. The map folders mix casing freely (`text/`,
 * `Text/`, `TEXT/`, `Pol/`, `Strings.ini`, `Minimap/` all ship), which a case-insensitive macOS/Windows
 * filesystem hides but a case-sensitive Linux one does not — resolving via directory listing keeps the
 * pipeline portable. Among same-named entries differing only in case (never observed), the
 * lexicographically first wins, so a re-run is deterministic.
 */
export async function findPathCaseInsensitive(
  dir: string,
  segments: readonly string[],
): Promise<string | null> {
  let current = dir;
  for (const segment of segments) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return null; // `current` missing or not a directory — the path does not resolve
    }
    const wanted = segment.toLowerCase();
    const match = entries.filter((e) => e.toLowerCase() === wanted).sort()[0];
    if (match === undefined) return null;
    current = join(current, match);
  }
  return current;
}
