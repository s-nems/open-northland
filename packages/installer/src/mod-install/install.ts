import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { CULTURESNATION_MOD } from '@open-northland/asset-pipeline';
import type { ModEvent } from '../ipc.js';
import { findModRootUnder } from './discover.js';
import { CNMOD_KNOWN_SHA256, downloadCnModZip, type ModDownloadOptions } from './download.js';
import { extractModZip } from './extract.js';

const DOWNLOAD_ZIP_NAME = 'cnmod-download.zip';

/** Dot-prefixed so `discoverInstalledMod` skips a half-written mod after an interrupted install. */
const STAGING_DIR_NAME = '.installing';

/** Folder name for a mod root the archive did not wrap in its own `CnMod <version>/` dir. */
const UNWRAPPED_MOD_DIR_NAME = 'CnMod';

/**
 * Downloads, verifies, and unpacks the archive into `modsDir`, returning the installed mod root. A
 * hash mismatch only warns: a newer mod release must not brick the installer.
 */
export async function installCnMod(
  modsDir: string,
  onEvent: (event: ModEvent) => void,
  options?: ModDownloadOptions,
): Promise<string> {
  await mkdir(modsDir, { recursive: true });
  const zipPath = join(modsDir, DOWNLOAD_ZIP_NAME);
  const stagingDir = join(modsDir, STAGING_DIR_NAME);
  try {
    const sha256 = await downloadCnModZip(zipPath, onEvent, options);
    if (sha256 !== CNMOD_KNOWN_SHA256) {
      onEvent({
        kind: 'mod-warning',
        message: `downloaded archive differs from the verified CnMod 1.3.1 (sha256 ${sha256}) - likely a newer mod release`,
      });
    }
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });
    const files = await extractModZip(zipPath, stagingDir, onEvent, options?.signal);
    if (files === 0) throw new Error('mod install: the downloaded archive contained no files');
    const root = await findModRootUnder(stagingDir);
    if (root === undefined) {
      throw new Error(`mod install: no ${CULTURESNATION_MOD}/ found inside the downloaded archive`);
    }
    const finalName = root === stagingDir ? UNWRAPPED_MOD_DIR_NAME : basename(root);
    const finalPath = join(modsDir, finalName);
    await rm(finalPath, { recursive: true, force: true });
    await rename(root, finalPath);
    return finalPath;
  } finally {
    await rm(zipPath, { force: true });
    await rm(stagingDir, { recursive: true, force: true });
  }
}
