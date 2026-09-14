import { formatMessage, localeTag, messages } from '@open-northland/installer/i18n';

/**
 * What the shell needs from browser storage, and what it tells the visitor when it is not there.
 */

const GB = 1e9;

/** Approximation from a full conversion of the mod: ~1 GB of content, the ~600 MB mod archive, and
 *  the ~1 GB tree it unpacks to. Used only to refuse a visibly hopeless start. */
const CONVERSION_BYTES = 3 * GB;

/** Storage can be present as an API and still refused: blocking site data leaves the methods in
 *  place and rejects the call. */
export async function assertStorageAvailable(): Promise<void> {
  try {
    await navigator.storage.getDirectory();
  } catch {
    throw new Error(messages().errors.noStorage);
  }
}

/** Asks the browser to stop evicting this origin. A refusal only makes eviction possible, not
 *  certain, so it is never fatal. */
export async function requestPersistentStorage(): Promise<void> {
  await navigator.storage.persist?.();
}

/** The one storage failure a visitor can act on, worded for them; undefined for anything else. */
export function storageFullMessage(error: unknown): string | undefined {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
    ? messages().errors.storageFull
    : undefined;
}

/** Bytes this origin may still write, or undefined when the browser will not estimate. */
async function availableBytes(): Promise<number | undefined> {
  const estimate = await navigator.storage.estimate?.();
  if (estimate?.quota === undefined) return undefined;
  return Math.max(0, estimate.quota - (estimate.usage ?? 0));
}

/** An absent estimate is not an objection. */
export async function hasRoomForConversion(): Promise<boolean> {
  const available = await availableBytes();
  return available === undefined || available >= CONVERSION_BYTES;
}

const gb = (bytes: number): string => (bytes / GB).toLocaleString(localeTag(), { maximumFractionDigits: 1 });

/** Refuses work the browser visibly cannot hold. */
export async function assertRoomForConversion(): Promise<void> {
  if (await hasRoomForConversion()) return;
  throw new Error(
    formatMessage(messages().errors.notEnoughStorage, {
      needed: gb(CONVERSION_BYTES),
      available: gb((await availableBytes()) ?? 0),
    }),
  );
}
