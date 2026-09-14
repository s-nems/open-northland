import { CULTURESNATION_MOD } from '@open-northland/asset-pipeline/mod-root';
import { type ReadableVfs, type Vfs, vjoin } from '@open-northland/vfs';

/** Present inside a mod directory only while it is being unpacked, so a half-written tree never
 *  resolves as a usable mod. */
const INCOMPLETE_MARKER = '.incomplete';

export async function markIncomplete(fs: Vfs, modRoot: string): Promise<void> {
  await fs.writeFile(vjoin(modRoot, INCOMPLETE_MARKER), new Uint8Array(0));
}

export async function markComplete(fs: Vfs, modRoot: string): Promise<void> {
  await fs.rm(vjoin(modRoot, INCOMPLETE_MARKER));
}

async function isIncomplete(fs: ReadableVfs, modRoot: string): Promise<boolean> {
  return (await fs.stat(vjoin(modRoot, INCOMPLETE_MARKER))) !== undefined;
}

/**
 * Locates a mod root (a directory containing `DataCnmd/`) at `dir` or one level below - the CnMod
 * zip wraps everything in a `CnMod <version>/` folder, but a rezipped archive might not.
 */
export async function findModRootUnder(fs: ReadableVfs, dir: string): Promise<string | undefined> {
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
export async function discoverInstalledMod(fs: ReadableVfs, modsDir: string): Promise<string | undefined> {
  let children: string[];
  try {
    children = (await fs.readdir(modsDir))
      // A dot-directory is scratch space of some install, never a mod an installer put there.
      .filter((e) => e.kind === 'dir' && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return undefined;
  }
  for (const child of children.sort().reverse()) {
    const dir = vjoin(modsDir, child);
    // The marker sits on the directory an install owns; the root it holds can be one level below.
    if (await isIncomplete(fs, dir)) continue;
    const candidate = await findModRootUnder(fs, dir);
    if (candidate !== undefined && !(await isIncomplete(fs, candidate))) return candidate;
  }
  return undefined;
}
