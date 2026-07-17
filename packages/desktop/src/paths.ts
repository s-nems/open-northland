import { join } from 'node:path';

/**
 * Where the desktop shell keeps its writable state — the pipeline's `content/` output (~1.2 GB on
 * the real game) and `desktop-config.json`. Following the OpenRA/OpenTTD convention the app dir
 * stays read-only and data lives per-user, with a `portable-data/` marker dir beside the executable
 * overriding that for a self-contained install.
 */

/** The marker directory next to the executable that switches the shell to portable mode. */
export const PORTABLE_DIR_NAME = 'portable-data';

/** Env override for the data root — the wizard/e2e test seam (a dev checkout otherwise boots into the repo's own content). */
export const DATA_DIR_ENV = 'OPEN_NORTHLAND_DATA_DIR';

export interface DataRootInputs {
  /** `OPEN_NORTHLAND_DATA_DIR` when set. */
  readonly envOverride: string | undefined;
  /** The directory holding the executable (`dirname(process.execPath)`). */
  readonly execDir: string;
  /** Electron's per-user data dir (`app.getPath('userData')`). */
  readonly userDataDir: string;
  /** The repo root in a dev (unpackaged) run, `undefined` when packaged. */
  readonly devRepoRoot: string | undefined;
  readonly directoryExists: (path: string) => boolean;
}

export interface DataRoot {
  readonly path: string;
  readonly portable: boolean;
}

/**
 * Resolve the data root: env override → `portable-data/` beside the executable → dev repo root
 * (so `npm run start` reuses the checkout's generated `content/`) → the per-user data dir.
 */
export function resolveDataRoot(inputs: DataRootInputs): DataRoot {
  if (inputs.envOverride !== undefined && inputs.envOverride !== '') {
    return { path: inputs.envOverride, portable: false };
  }
  const portable = join(inputs.execDir, PORTABLE_DIR_NAME);
  if (inputs.directoryExists(portable)) return { path: portable, portable: true };
  if (inputs.devRepoRoot !== undefined) return { path: inputs.devRepoRoot, portable: false };
  return { path: inputs.userDataDir, portable: false };
}

/** The pipeline output dir under a data root — the `content/` tree the app's routes serve. */
export function contentDirOf(dataRoot: string): string {
  return join(dataRoot, 'content');
}

/** The shell's config file under a data root. */
export function configFileOf(dataRoot: string): string {
  return join(dataRoot, 'desktop-config.json');
}

/** Where downloaded mods live under a data root (`mods/<name>/DataCnmd/…`) — never the game folder. */
export function modsDirOf(dataRoot: string): string {
  return join(dataRoot, 'mods');
}
