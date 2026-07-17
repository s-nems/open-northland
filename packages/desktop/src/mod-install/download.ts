import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ModEvent } from '../ipc.js';

/**
 * Fetches the culturesnation mod archive. The download flow (verified against the live endpoints,
 * 2026-07): culturesnation.pl's download link 302-redirects to a Google Drive file page; Drive
 * answers a large-file GET with an HTML "can't scan for viruses" confirm form whose hidden fields,
 * replayed as query params, yield the real byte stream.
 */

/** culturesnation.pl's stable download entry — redirects to the current mod archive. */
const CNMOD_DOWNLOAD_URL = 'https://culturesnation.pl/serwerdownload.php?cat_id=8&file_id=344&limit=35688644';

/** SHA-256 of the known-good `CnMod 1.3.1.zip` the URL above resolved to; a mismatch means a new
 *  (unverified) mod version. Kept beside the URL: a mod release bumps both together. */
export const CNMOD_KNOWN_SHA256 = '847e974a4a56960e081fb313d655a85b6256cd2e6cb9430d4974ff1826170ad9';

/** The largest Drive interstitial page the downloader will buffer — a hop that answers with more
 * HTML than this is not the confirm form (the real one is ~2 KB). */
const MAX_INTERSTITIAL_BYTES = 1 << 20;

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
  // The form must submit back to Google — a page steering the download anywhere else (a tampered
  // interstitial) is refused rather than fetched, since the pinned hash only warns on a mismatch.
  try {
    const host = new URL(action).hostname;
    if (host !== 'google.com' && !host.endsWith('.google.com')) return undefined;
  } catch {
    return undefined;
  }
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

/** Rejects a non-2xx hop with its real status instead of streaming an error page to disk. */
function assertOk(response: Response, hop: string): void {
  if (!response.ok)
    throw new Error(`mod download: ${hop} answered ${response.status} ${response.statusText}`);
}

/** Reads at most {@link MAX_INTERSTITIAL_BYTES} of a text response — never the whole body. */
async function readBoundedText(response: Response): Promise<string> {
  if (response.body === null) return '';
  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    received += chunk.length;
    if (received >= MAX_INTERSTITIAL_BYTES) break;
  }
  await response.body.cancel().catch(() => undefined);
  return Buffer.concat(chunks, Math.min(received, MAX_INTERSTITIAL_BYTES)).toString('utf8');
}

/** Streams `response` to `file`, reporting progress and returning the stream's SHA-256 hex. */
async function streamToFile(
  response: Response,
  file: string,
  onEvent: (event: ModEvent) => void,
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

/** Options shared by the download and the install that wraps it. */
export interface ModDownloadOptions {
  readonly signal?: AbortSignal;
  readonly fetchFn?: typeof fetch;
  readonly url?: string;
}

/**
 * Downloads the mod archive to `destZip` via the culturesnation.pl → Google Drive hop chain and
 * returns its SHA-256. Any hop may already answer with the file itself (a future direct mirror
 * short-circuits the Drive dance).
 */
export async function downloadCnModZip(
  destZip: string,
  onEvent: (event: ModEvent) => void,
  options?: ModDownloadOptions,
): Promise<string> {
  const fetchFn = options?.fetchFn ?? fetch;
  const signal = options?.signal;
  const first = await fetchFn(options?.url ?? CNMOD_DOWNLOAD_URL, { signal: signal ?? null });
  assertOk(first, 'the culturesnation.pl link');
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
  assertOk(second, 'Google Drive');
  if (isFileResponse(second)) return streamToFile(second, destZip, onEvent, signal);

  const confirmUrl = parseDriveConfirmUrl(await readBoundedText(second));
  if (confirmUrl === undefined) {
    throw new Error(
      'mod download: Google Drive did not offer a download form (quota exceeded, or the page changed)',
    );
  }
  const third = await fetchFn(confirmUrl, { signal: signal ?? null });
  assertOk(third, 'the Google Drive download');
  if (!isFileResponse(third)) {
    throw new Error('mod download: Google Drive kept answering with a page instead of the file');
  }
  return streamToFile(third, destZip, onEvent, signal);
}
