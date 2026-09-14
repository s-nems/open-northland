import { CULTURESNATION_MOD } from '@open-northland/asset-pipeline/mod-root';
import { type Vfs, vjoin } from '@open-northland/vfs';
import type { ModEvent } from '../shell-api.js';
import { markComplete, markIncomplete } from './discover.js';
import { extractModEntries, modLayoutOf } from './extract.js';
import { readZipEntries, vfsZipSource } from './zip.js';

const DOWNLOAD_ZIP_NAME = 'cnmod-download.zip';

/** SHA-256 of the `CnMod 1.3.2.zip` the project serves; a mismatch means an unverified mod version. */
export const CNMOD_KNOWN_SHA256 = '68537a89a972621f5dc400912e0c660bd875f649b693f3dad70d26f49465f043';

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
  let target: string | undefined;
  try {
    const sha256 = await download(zipPath, onEvent, options?.signal);
    if (sha256 !== undefined && sha256 !== CNMOD_KNOWN_SHA256) {
      onEvent({
        kind: 'mod-warning',
        message: `downloaded archive differs from the verified CnMod 1.3.2 (sha256 ${sha256}) - likely a newer mod release`,
      });
    }
    const source = await vfsZipSource(fs, zipPath);
    const all = await readZipEntries(source);
    const layout = modLayoutOf(all);
    if (layout === undefined) {
      throw new Error(`mod install: no ${CULTURESNATION_MOD}/ found inside the downloaded archive`);
    }
    target = vjoin(modsDir, layout.name);
    await fs.rm(target);
    await markIncomplete(fs, target);
    const files = await extractModEntries(
      fs,
      { source, entries: all, layout, destDir: target },
      onEvent,
      options?.signal,
    );
    if (files === 0) throw new Error('mod install: the downloaded archive contained no files');
    await markComplete(fs, target);
    return target;
  } catch (error) {
    // Cleanup is best-effort: the incomplete marker already keeps a surviving tree out of
    // discovery, so a locked file must not replace the failure the caller needs to see.
    if (target !== undefined) await fs.rm(target).catch(() => {});
    throw error;
  } finally {
    await fs.rm(zipPath).catch(() => {});
  }
}
