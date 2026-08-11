import type { ModEvent } from '@open-northland/installer';
import { formatMessage, messages } from '@open-northland/installer/i18n';
import type { ModZipDownload } from '@open-northland/installer/mod-install';

/** Where the site hosts the CnMod archive, beside the installer page (same origin, no CORS). */
const CNMOD_ARCHIVE_URL = new URL('cnmod.zip', document.baseURI);

/**
 * Streams `response` into an OPFS file chunk by chunk - the ~600 MB archive must never sit in memory
 * whole. Resolves to undefined: the web transport has no streaming hash, and the archive comes from
 * this site anyway.
 */
async function streamToOpfsFile(
  destZip: string,
  response: Response,
  onEvent: (event: ModEvent) => void,
  signal: AbortSignal | undefined,
): Promise<undefined> {
  if (response.body === null) throw new Error('mod download: empty response body');
  const lengthHeader = response.headers.get('content-length');
  const total = lengthHeader === null ? undefined : Number.parseInt(lengthHeader, 10);
  let dir = await navigator.storage.getDirectory();
  const segments = destZip.split('/');
  const name = segments.pop();
  if (name === undefined || name === '') throw new Error(`mod download: unusable path ${destZip}`);
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true });
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  const reader = response.body.getReader();
  let received = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      received += value.length;
      onEvent({ kind: 'mod-download', received, ...(total !== undefined ? { total } : {}) });
    }
    await writable.close();
  } catch (error) {
    // Closing a stream that already errored rejects with a TypeError of its own, which would hide
    // the quota failure this page words for the visitor.
    await writable.abort().catch(() => {});
    throw error;
  }
  return undefined;
}

/** Fetches the archive this origin hosts. A missing one means the origin is misconfigured, which is
 *  the visitor's cue to take the fallback route rather than an internal error. */
export function siteArchiveDownload(): ModZipDownload {
  return async (destZip, onEvent, signal) => {
    const response = await fetch(CNMOD_ARCHIVE_URL, { signal: signal ?? null });
    if (!response.ok) {
      throw new Error(
        formatMessage(messages().errors.modArchiveUnavailable, { status: String(response.status) }),
      );
    }
    return streamToOpfsFile(destZip, response, onEvent, signal);
  };
}

/** Adopts an archive the visitor already has, without a round trip through the network. */
export function pickedArchiveDownload(file: File): ModZipDownload {
  return (destZip, onEvent, signal) => streamToOpfsFile(destZip, new Response(file), onEvent, signal);
}
