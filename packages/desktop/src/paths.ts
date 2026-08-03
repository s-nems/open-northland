import { join } from 'node:path';

/**
 * Convention (OpenRA, OpenTTD): the install directory stays read-only and the shell's writable
 * state lives per-user.
 */

/** The marker directory beside the executable that switches the shell to portable mode. */
export const PORTABLE_DIR_NAME = 'portable-data';

/** Env override for the data root; the seam tests use to avoid a dev checkout's own content. */
export const DATA_DIR_ENV = 'OPEN_NORTHLAND_DATA_DIR';

export interface DataRootInputs {
  readonly envOverride: string | undefined;
  /** The directory holding the executable (`dirname(process.execPath)`). */
  readonly execDir: string;
  /** Electron's per-user data dir (`app.getPath('userData')`). */
  readonly userDataDir: string;
  /** The repo root in an unpackaged run. */
  readonly devRepoRoot: string | undefined;
  readonly directoryExists: (path: string) => boolean;
}

export interface DataRoot {
  readonly path: string;
  readonly portable: boolean;
}

/** The dev-repo-root step lets `npm run start` reuse the checkout's already generated `content/`. */
export function resolveDataRoot(inputs: DataRootInputs): DataRoot {
  if (inputs.envOverride !== undefined && inputs.envOverride !== '') {
    return { path: inputs.envOverride, portable: false };
  }
  const portable = join(inputs.execDir, PORTABLE_DIR_NAME);
  if (inputs.directoryExists(portable)) return { path: portable, portable: true };
  if (inputs.devRepoRoot !== undefined) return { path: inputs.devRepoRoot, portable: false };
  return { path: inputs.userDataDir, portable: false };
}

export function contentDirOf(dataRoot: string): string {
  return join(dataRoot, 'content');
}

export function configFileOf(dataRoot: string): string {
  return join(dataRoot, 'desktop-config.json');
}

/** Downloaded mod roots, laid out as `mods/<name>/DataCnmd/`, never the game folder. */
export function modsDirOf(dataRoot: string): string {
  return join(dataRoot, 'mods');
}
