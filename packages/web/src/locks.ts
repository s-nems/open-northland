/**
 * Origin-wide exclusion for the two jobs that write shared storage. A held lock lives until the
 * returned release runs, so it is taken for the whole job rather than for the length of a callback.
 */
export function acquireOriginLock(name: string): Promise<(() => void) | undefined> {
  // Without the Web Locks API there is nothing to coordinate through; one tab is the assumption.
  if (navigator.locks === undefined) return Promise.resolve(() => {});
  return new Promise<(() => void) | undefined>((resolve) => {
    void navigator.locks.request(name, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(undefined);
        return Promise.resolve();
      }
      return new Promise<void>((release) => resolve(() => release()));
    });
  });
}
