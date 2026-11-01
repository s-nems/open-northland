import { MapImportError } from '@open-northland/map-import';
import { errorMessage } from '../log.js';
import { ResponseTooLargeError, readCappedBody } from '../upstream/body.js';
import type { Fetch } from '../upstream/strapi.js';

/** The upstream did not deliver the file: an error status, a dropped connection, a timeout or a body
 *  that disagrees with its declared length. Worth retrying on the next sync. */
export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadLimits {
  readonly maxBytes: number;
  readonly timeoutMs: number;
}

/** Redirect statuses an archive download follows: community hosts hand their files out through a
 *  download script that first redirects to the file itself, and refusing the hop fails the whole
 *  download with a bare `fetch failed`. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Refuses a host that sends the download around in circles. */
const MAX_REDIRECTS = 5;
/** Some map hosts drop requests that name no browser agent, and Node's default names `node`. The
 *  comment URL tells a host's owner which traffic this is. */
const REQUEST_HEADERS: Readonly<Record<string, string>> = {
  'user-agent':
    'Mozilla/5.0 (compatible; open-northland-catalog/1.0; +https://github.com/s-nems/open-northland)',
  accept: '*/*',
};

function declaredLength(response: Response): number | null {
  const header = response.headers.get('content-length');
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

/** The cause a network-level fetch failure hides: `fetch failed` alone names none of the details. */
function failureDetail(error: unknown): string | null {
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof AggregateError)
    return (
      cause.errors
        .map((inner) => (inner as NodeJS.ErrnoException).code ?? errorMessage(inner))
        .find((text) => text !== '') ?? null
    );
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code !== undefined) return code;
    return cause.message === '' ? null : cause.message;
  }
  return cause === undefined || cause === null ? null : String(cause);
}

/** The file at `url`, refused as `too-large` past `maxBytes` whether declared or received. Follows
 *  up to {@link MAX_REDIRECTS} http(s) redirects, as download scripts hand the file out with a hop. */
export async function downloadArchive(
  fetchFn: Fetch,
  url: string,
  limits: DownloadLimits,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const deadline =
    signal === undefined
      ? AbortSignal.timeout(limits.timeoutMs)
      : AbortSignal.any([signal, AbortSignal.timeout(limits.timeoutMs)]);
  try {
    let target = url;
    for (let hops = 0; ; hops++) {
      const response = await fetchFn(target, {
        redirect: 'manual',
        headers: { ...REQUEST_HEADERS, referer: new URL('.', target).href },
        signal: deadline,
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        if (hops === MAX_REDIRECTS) throw new DownloadError(`${url}: more than ${MAX_REDIRECTS} redirects`);
        const location = response.headers.get('location');
        if (location === null)
          throw new DownloadError(`${target} answered ${response.status} without a location`);
        const next = new URL(location, target);
        if (next.protocol !== 'http:' && next.protocol !== 'https:')
          throw new DownloadError(`${target} redirects away from http(s): ${next.href}`);
        target = next.href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new DownloadError(`${target} answered ${response.status}`);
      }
      const declared = declaredLength(response);
      if (declared !== null && declared > limits.maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new MapImportError(
          'too-large',
          `${target}: declares ${declared} bytes, over ${limits.maxBytes}`,
        );
      }
      const bytes = await readCappedBody(response, limits.maxBytes);
      if (declared !== null && bytes.byteLength !== declared) {
        throw new DownloadError(`${target}: received ${bytes.byteLength} of ${declared} declared bytes`);
      }
      return bytes;
    }
  } catch (error) {
    if (error instanceof ResponseTooLargeError)
      throw new MapImportError('too-large', `${url}: more than ${limits.maxBytes} bytes`);
    if (error instanceof MapImportError || error instanceof DownloadError) throw error;
    const detail = failureDetail(error);
    throw new DownloadError(`${url}: ${errorMessage(error)}${detail === null ? '' : ` (${detail})`}`);
  }
}
