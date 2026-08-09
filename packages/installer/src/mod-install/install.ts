import { CULTURESNATION_MOD } from '@open-northland/asset-pipeline';
import { type Vfs, vbasename, vjoin } from '@open-northland/vfs';
import type { ModEvent } from '../shell-api.js';
import { findModRootUnder } from './discover.js';
import { extractModZip } from './extract.js';

const DOWNLOAD_ZIP_NAME = 'cnmod-download.zip';

/** Dot-prefixed so `discoverInstalledMod` skips a half-written mod after an interrupted install. */
const STAGING_DIR_NAME = '.installing';

/** Folder name for a mod root the archive did not wrap in its own `CnMod <version>/` dir. */
const UNWRAPPED_MOD_DIR_NAME = 'CnMod';

/** SHA-256 of the verified `CnMod 1.3.1.zip`; a mismatch means an unverified mod version. */
export const CNMOD_KNOWN_SHA256 = '847e974a4a56960e081fb313d655a85b6256cd2e6cb9430d4974ff1826170ad9';

export interface ModInstallOptions {
  readonly signal?: AbortSignal;
}

/** Fetches the archive to `destZip`, reporting `mod-download` events; returns the bytes' SHA-256 as
 *  hex, or undefined when the transport cannot hash the stream. */
export type ModZipDownload = (
  destZip: string,
  onEvent: (event: ModEvent) => void,
  signal: AbortSignal | undefined,
) => Promise<string | undefined>;

/**
 * Downloads, verifies, and unpacks the archive into `modsDir`, returning the installed mod root. A
 * hash mismatch only warns: a newer mod release must not brick the installer.
 */
export async function installCnMod(
  fs: Vfs,
  modsDir: string,
  download: ModZipDownload,
  onEvent: (event: ModEvent) => void,
  options?: ModInstallOptions,
): Promise<string> {
  await fs.mkdir(modsDir);
  const zipPath = vjoin(modsDir, DOWNLOAD_ZIP_NAME);
  const stagingDir = vjoin(modsDir, STAGING_DIR_NAME);
  try {
    const sha256 = await download(zipPath, onEvent, options?.signal);
    if (sha256 !== undefined && sha256 !== CNMOD_KNOWN_SHA256) {
      onEvent({
        kind: 'mod-warning',
        message: `downloaded archive differs from the verified CnMod 1.3.1 (sha256 ${sha256}) - likely a newer mod release`,
      });
    }
    await fs.rm(stagingDir);
    await fs.mkdir(stagingDir);
    const files = await extractModZip(fs, zipPath, stagingDir, onEvent, options?.signal);
    if (files === 0) throw new Error('mod install: the downloaded archive contained no files');
    const root = await findModRootUnder(fs, stagingDir);
    if (root === undefined) {
      throw new Error(`mod install: no ${CULTURESNATION_MOD}/ found inside the downloaded archive`);
    }
    const finalName = root === stagingDir ? UNWRAPPED_MOD_DIR_NAME : vbasename(root);
    const finalPath = vjoin(modsDir, finalName);
    await fs.rm(finalPath);
    await fs.rename(root, finalPath);
    return finalPath;
  } finally {
    await fs.rm(zipPath);
    await fs.rm(stagingDir);
  }
}
