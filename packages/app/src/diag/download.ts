/** Firefox aborts a download whose object URL is revoked before the download starts. */
const REVOKE_DELAY_MS = 10_000;

export function downloadJsonFile(filename: string, body: string): void {
  const blob = new Blob([body], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
