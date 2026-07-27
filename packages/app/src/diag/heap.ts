/**
 * The JS heap in whole MB, or null where the browser does not expose it. `performance.memory` is a
 * non-standard Chrome-only field (undefined in Firefox/Safari and headless software-GL runs), so it is
 * read defensively and simply omitted when absent - a leak/GC signal for the one browser that has it.
 */
export function heapMb(): number | null {
  const mem = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  if (mem === undefined || typeof mem.usedJSHeapSize !== 'number') return null;
  return Math.round(mem.usedJSHeapSize / (1024 * 1024));
}
