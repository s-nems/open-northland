import { formatMessage, messages } from '@open-northland/installer/i18n';

/**
 * What the shell needs from browser storage, and what it tells the visitor when it is not there.
 */

const GB = 1e9;

/** Approximation from a full conversion of the owned copy: ~1.2 GB of content, the ~600 MB mod
 *  archive, and the tree it unpacks to. Used only to refuse a visibly hopeless start. */
const CONVERSION_BYTES = 3 * GB;

export function assertStorageAvailable(): void {
  if (typeof navigator.storage?.getDirectory !== 'function') {
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

/** Refuses work the browser visibly cannot hold. An absent estimate is not an objection. */
export async function assertRoomForConversion(): Promise<void> {
  const estimate = await navigator.storage.estimate?.();
  if (estimate?.quota === undefined) return;
  const available = estimate.quota - (estimate.usage ?? 0);
  if (available >= CONVERSION_BYTES) return;
  throw new Error(
    formatMessage(messages().errors.notEnoughStorage, {
      needed: (CONVERSION_BYTES / GB).toFixed(1),
      available: Math.max(0, available / GB).toFixed(1),
    }),
  );
}
