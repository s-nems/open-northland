/** Firefox aborts a download whose object URL is revoked before the download starts. */
const REVOKE_DELAY_MS = 10_000;

export function downloadFile(filename: string, body: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

export function downloadJsonFile(filename: string, body: string): void {
  downloadFile(filename, body, 'application/json');
}
