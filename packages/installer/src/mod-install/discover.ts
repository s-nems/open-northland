import { CULTURESNATION_MOD } from '@open-northland/asset-pipeline';
import { type Vfs, vjoin } from '@open-northland/vfs';

/**
 * Locates a mod root (a directory containing `DataCnmd/`) at `dir` or one level below - the CnMod
 * zip wraps everything in a `CnMod <version>/` folder, but a rezipped archive might not.
 */
export async function findModRootUnder(fs: Vfs, dir: string): Promise<string | undefined> {
  const hasMod = async (candidate: string): Promise<boolean> =>
    (await fs.stat(vjoin(candidate, CULTURESNATION_MOD)))?.kind === 'dir';
  if (await hasMod(dir)) return dir;
  let children: string[];
  try {
    children = (await fs.readdir(dir)).filter((e) => e.kind === 'dir').map((e) => e.name);
  } catch {
    return undefined;
  }
  for (const child of children.sort()) {
    const candidate = vjoin(dir, child);
    if (await hasMod(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The installed mod root under `modsDir`, or undefined. Approximation: the lexicographically last
 * folder is the newest, which holds for dotted `CnMod 1.3.1` names of equal segment width.
 */
export async function discoverInstalledMod(fs: Vfs, modsDir: string): Promise<string | undefined> {
  let children: string[];
  try {
    children = (await fs.readdir(modsDir))
      // A dot-dir is an interrupted install's staging dir, never an installed mod.
      .filter((e) => e.kind === 'dir' && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return undefined;
  }
  for (const child of children.sort().reverse()) {
    const candidate = await findModRootUnder(fs, vjoin(modsDir, child));
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}
