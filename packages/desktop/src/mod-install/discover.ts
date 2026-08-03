import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CULTURESNATION_MOD } from '@open-northland/asset-pipeline';

/**
 * Locates a mod root (a directory containing `DataCnmd/`) at `dir` or one level below - the CnMod
 * zip wraps everything in a `CnMod <version>/` folder, but a rezipped archive might not.
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
 * The installed mod root under `modsDir`, or undefined. Approximation: the lexicographically last
 * folder is the newest, which holds for dotted `CnMod 1.3.1` names of equal segment width.
 */
export async function discoverInstalledMod(modsDir: string): Promise<string | undefined> {
  let children: string[];
  try {
    children = (await readdir(modsDir, { withFileTypes: true }))
      // A dot-dir is an interrupted install's staging dir, never an installed mod.
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
