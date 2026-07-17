import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CULTURESNATION_MOD } from '@open-northland/asset-pipeline';

/** Finds an unpacked mod root — a directory holding `DataCnmd/` — under a picked or installed folder. */

/**
 * Locates a mod root (a directory that contains `DataCnmd/`) at `dir` itself or one level below —
 * the CnMod zip wraps everything in one `CnMod <version>/` top folder, but a rezipped archive
 * might not.
 */
export async function findModRootUnder(dir: string): Promise<string | undefined> {
  const hasMod = async (candidate: string): Promise<boolean> => {
    try {
      return (await stat(join(candidate, CULTURESNATION_MOD))).isDirectory();
    } catch {
      return false;
    }
  };
  if (await hasMod(dir)) return dir;
  let children: string[];
  try {
    children = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return undefined;
  }
  for (const child of children.sort()) {
    const candidate = join(dir, child);
    if (await hasMod(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The already-installed mod root under the data root's `mods/` dir, or undefined. Among several
 * installed versions the lexicographically last wins — the CnMod folder names embed the version
 * (`CnMod 1.3.1`), so that is the newest (an approximation that holds for dotted versions of equal
 * segment width).
 */
export async function discoverInstalledMod(modsDir: string): Promise<string | undefined> {
  let children: string[];
  try {
    children = (await readdir(modsDir, { withFileTypes: true }))
      // Dot-dirs are never installed mods — `.installing/` in particular is the extraction staging
      // area, whose half-written DataCnmd/ must not be discovered after an interrupted install.
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return undefined;
  }
  for (const child of children.sort().reverse()) {
    const candidate = await findModRootUnder(join(modsDir, child));
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}
