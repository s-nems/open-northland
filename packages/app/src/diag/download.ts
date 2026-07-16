/** The shared blob-download helper for the diagnostics report and the trace export. */

/** Milliseconds to keep a downloaded blob's object URL alive — Firefox aborts a download whose URL
 *  is revoked before it starts, and the bundle download is the crash-path artifact. */
const REVOKE_DELAY_MS = 10_000;

/** Download `body` as a standalone JSON file named `filename`. */
export function downloadJsonFile(filename: string, body: string): void {
  const blob = new Blob([body], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
