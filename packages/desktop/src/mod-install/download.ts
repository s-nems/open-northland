import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ModEvent } from '../ipc.js';

/**
 * Fetches the culturesnation mod archive over an observed hop chain: culturesnation.pl's link
 * 302-redirects to a Google Drive file page, and Drive answers a large-file GET with an HTML confirm
 * form whose hidden fields, replayed as query params, yield the byte stream.
 */

/** culturesnation.pl's stable download entry - redirects to the current mod archive. */
const CNMOD_DOWNLOAD_URL = 'https://culturesnation.pl/serwerdownload.php?cat_id=8&file_id=344&limit=35688644';

/** SHA-256 of the verified `CnMod 1.3.1.zip`; a mismatch means an unverified mod version. */
export const CNMOD_KNOWN_SHA256 = '847e974a4a56960e081fb313d655a85b6256cd2e6cb9430d4974ff1826170ad9';

/** Cap on buffered interstitial HTML; the observed Drive confirm form is ~2 KB. */
const MAX_INTERSTITIAL_BYTES = 1 << 20;

export function parseDriveFileId(url: string): string | undefined {
  return /\/file\/d\/([\w-]+)/.exec(url)?.[1];
}

export function parseDriveConfirmUrl(html: string): string | undefined {
  const action = /<form[^>]+action="([^"]+)"/.exec(html)?.[1];
  if (action === undefined) return undefined;
  // Security boundary: only a google.com action is followed, since the pinned hash only warns.
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

function isFileResponse(response: Response): boolean {
  const type = response.headers.get('content-type') ?? '';
  return !type.includes('text/html');
}

/** Fails a non-2xx hop instead of streaming its error page to disk. */
function assertOk(response: Response, hop: string): void {
  if (!response.ok)
    throw new Error(`mod download: ${hop} answered ${response.status} ${response.statusText}`);
}

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

/** Streams `response` into `file` and returns the bytes' SHA-256 as hex. */
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

export interface ModDownloadOptions {
  readonly signal?: AbortSignal;
  readonly fetchFn?: typeof fetch;
  readonly url?: string;
}

/**
 * Downloads the mod archive to `destZip` and returns its SHA-256. Any hop may already answer with
 * the file itself, short-circuiting the rest of the chain.
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
