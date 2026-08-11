import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ModEvent } from '@open-northland/installer';

/**
 * Fetches the culturesnation mod archive from the project's own origin, the same bytes the web
 * installer serves at its root.
 */

const CNMOD_DOWNLOAD_URL = 'https://game.opennorthland.org/cnmod.zip';

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

/** Downloads the mod archive to `destZip` and returns its SHA-256. */
export async function downloadCnModZip(
  destZip: string,
  onEvent: (event: ModEvent) => void,
  options?: ModDownloadOptions,
): Promise<string> {
  const fetchFn = options?.fetchFn ?? fetch;
  const signal = options?.signal;
  const url = options?.url ?? CNMOD_DOWNLOAD_URL;
  const response = await fetchFn(url, { signal: signal ?? null });
  if (!response.ok) {
    throw new Error(`mod download: ${url} answered ${response.status} ${response.statusText}`);
  }
  return streamToFile(response, destZip, onEvent, signal);
}
