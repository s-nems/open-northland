import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CULTURESNATION_MOD } from '@open-northland/asset-pipeline';
import { readZipEntries, readZipEntryData } from './zip.js';

/**
 * Downloads and installs the culturesnation mod into the data root's `mods/` dir — the game folder
 * stays read-only, so a mod the user's install lacks lives here and reaches the pipeline via
 * `--mod-root`. The download flow (verified against the live endpoints, 2026-07): culturesnation.pl's
 * download link 302-redirects to a Google Drive file page; Drive answers a large-file GET with an
 * HTML "can't scan for viruses" confirm form whose hidden fields, replayed as query params, yield
 * the real byte stream.
 */

/** culturesnation.pl's stable download entry — redirects to the current mod archive. */
export const CNMOD_DOWNLOAD_URL =
  'https://culturesnation.pl/serwerdownload.php?cat_id=8&file_id=344&limit=35688644';

/** SHA-256 of the known-good `CnMod 1.3.1.zip`; a mismatch means a new (unverified) mod version. */
export const CNMOD_KNOWN_SHA256 = '847e974a4a56960e081fb313d655a85b6256cd2e6cb9430d4974ff1826170ad9';

/** Progress the installer streams to the wizard; completion/failure ride the returned promise. */
export type ModInstallEvent =
  | { readonly kind: 'mod-download'; readonly received: number; readonly total?: number }
  | { readonly kind: 'mod-extract'; readonly done: number; readonly total: number }
  | { readonly kind: 'mod-warning'; readonly message: string };

/** The Google Drive file id out of a `drive.google.com/file/d/<id>/…` URL. */
export function parseDriveFileId(url: string): string | undefined {
  return /\/file\/d\/([\w-]+)/.exec(url)?.[1];
}

/**
 * The hidden fields of Drive's large-file confirm form (`id`, `export`, `confirm`, `uuid`), replayed
 * as query params on the form's action URL to get the actual stream. Undefined when the HTML carries
 * no form (Drive changed, or the file is gone).
 */
export function parseDriveConfirmUrl(html: string): string | undefined {
  const action = /<form[^>]+action="([^"]+)"/.exec(html)?.[1];
  if (action === undefined) return undefined;
  const params = new URLSearchParams();
  for (const input of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
    const [, name, value] = input;
    if (name !== undefined && value !== undefined) params.set(name, value);
  }
  if (!params.has('id')) return undefined;
  return `${action}?${params.toString()}`;
}

/** True when the response is the archive itself rather than an interstitial HTML page. */
function isFileResponse(response: Response): boolean {
  const type = response.headers.get('content-type') ?? '';
  return !type.includes('text/html');
}

/** Streams `response` to `file`, reporting progress and returning the stream's SHA-256 hex. */
async function streamToFile(
  response: Response,
  file: string,
  onEvent: (event: ModInstallEvent) => void,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (response.body === null) throw new Error('mod download: empty response body');
  const lengthHeader = response.headers.get('content-length');
  const total = lengthHeader === null ? undefined : Number.parseInt(lengthHeader, 10);
  const hash = createHash('sha256');
  let received = 0;
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        hash.update(chunk);
        received += chunk.length;
        onEvent({ kind: 'mod-download', received, ...(total !== undefined ? { total } : {}) });
        yield chunk;
      }
    },
    createWriteStream(file),
    signal !== undefined ? { signal } : {},
  );
  return hash.digest('hex');
}

/**
 * Downloads the mod archive to `destZip` via the culturesnation.pl → Google Drive hop chain and
 * returns its SHA-256. Any hop may already answer with the file itself (a future direct mirror
 * short-circuits the Drive dance).
 */
export async function downloadCnModZip(
  destZip: string,
  onEvent: (event: ModInstallEvent) => void,
  options?: { readonly signal?: AbortSignal; readonly fetchFn?: typeof fetch; readonly url?: string },
): Promise<string> {
  const fetchFn = options?.fetchFn ?? fetch;
  const signal = options?.signal;
  const first = await fetchFn(options?.url ?? CNMOD_DOWNLOAD_URL, { signal: signal ?? null });
  if (isFileResponse(first)) return streamToFile(first, destZip, onEvent, signal);

  const fileId = parseDriveFileId(first.url);
  if (fileId === undefined) {
    throw new Error(
      `mod download: the culturesnation.pl link did not lead to a Google Drive file (${first.url})`,
    );
  }
  await first.body?.cancel();
  const second = await fetchFn(`https://drive.usercontent.google.com/download?id=${fileId}&export=download`, {
    signal: signal ?? null,
  });
  if (isFileResponse(second)) return streamToFile(second, destZip, onEvent, signal);

  const confirmUrl = parseDriveConfirmUrl(await second.text());
  if (confirmUrl === undefined) {
    throw new Error(
      'mod download: Google Drive did not offer a download form (quota exceeded, or the page changed)',
    );
  }
  const third = await fetchFn(confirmUrl, { signal: signal ?? null });
  if (!isFileResponse(third)) {
    throw new Error('mod download: Google Drive kept answering with a page instead of the file');
  }
  return streamToFile(third, destZip, onEvent, signal);
}

/** A zip member name (forward-slash separated) as a safe extraction-relative path, or undefined to skip. */
export function zipMemberRelPath(name: string): string | undefined {
  const native = name.replace(/\//g, sep);
  const norm = normalize(native);
  if (norm === '' || norm === '.') return undefined;
  if (isAbsolute(norm) || norm === '..' || norm.startsWith(`..${sep}`)) return undefined;
  return norm;
}

/** Extracts every file member of `zipPath` under `destDir`; returns the number of files written. */
export async function extractModZip(
  zipPath: string,
  destDir: string,
  onEvent: (event: ModInstallEvent) => void,
): Promise<number> {
  const fh = await open(zipPath, 'r');
  try {
    const entries = (await readZipEntries(fh, (await stat(zipPath)).size)).filter(
      (e) => !e.name.endsWith('/'),
    );
    let done = 0;
    for (const entry of entries) {
      const rel = zipMemberRelPath(entry.name);
      if (rel === undefined) {
        onEvent({ kind: 'mod-warning', message: `skipped unsafe zip member "${entry.name}"` });
        continue;
      }
      const outPath = join(destDir, rel);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, await readZipEntryData(fh, entry));
      done++;
      onEvent({ kind: 'mod-extract', done, total: entries.length });
    }
    return done;
  } finally {
    await fh.close();
  }
}

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
      .filter((e) => e.isDirectory())
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

/**
 * The full install: download the archive into `modsDir`, verify it against the pinned hash (a
 * mismatch is a warning — a newer mod release must not brick the installer), extract into a staging
 * dir, and move the mod root into place. Returns the installed mod root. Cleans up the archive and
 * staging dir on success; a failed attempt's staging dir is re-created fresh on retry.
 */
export async function installCnMod(
  modsDir: string,
  onEvent: (event: ModInstallEvent) => void,
  options?: { readonly signal?: AbortSignal; readonly fetchFn?: typeof fetch; readonly url?: string },
): Promise<string> {
  await mkdir(modsDir, { recursive: true });
  const zipPath = join(modsDir, 'cnmod-download.zip');
  const stagingDir = join(modsDir, '.installing');
  try {
    const sha256 = await downloadCnModZip(zipPath, onEvent, options);
    if (sha256 !== CNMOD_KNOWN_SHA256) {
      onEvent({
        kind: 'mod-warning',
        message: `downloaded archive differs from the verified CnMod 1.3.1 (sha256 ${sha256}) — likely a newer mod release`,
      });
    }
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });
    const files = await extractModZip(zipPath, stagingDir, onEvent);
    if (files === 0) throw new Error('mod install: the downloaded archive contained no files');
    const root = await findModRootUnder(stagingDir);
    if (root === undefined) {
      throw new Error(`mod install: no ${CULTURESNATION_MOD}/ found inside the downloaded archive`);
    }
    const finalName = root === stagingDir ? 'CnMod' : basename(root);
    const finalPath = join(modsDir, finalName);
    await rm(finalPath, { recursive: true, force: true });
    await rename(root, finalPath);
    return finalPath;
  } finally {
    await rm(zipPath, { force: true });
    await rm(stagingDir, { recursive: true, force: true });
  }
}
