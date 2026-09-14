/**
 * The gzip envelope around a serialized save. Canonical JSON text stays the format and determinism
 * contract; compression is transport only, and a plain-JSON file stays loadable through the same
 * decode seam via the magic-byte sniff.
 */

const GZIP_MAGIC = [0x1f, 0x8b] as const;

/** Save file bytes are ArrayBuffer-backed, so they can enter a `Blob` and IndexedDB unwrapped. */
export type SaveBytes = Uint8Array<ArrayBuffer>;

export function isSaveBytes(value: unknown): value is SaveBytes {
  return value instanceof Uint8Array && value.buffer instanceof ArrayBuffer;
}

/** Ceiling on decoded save text: refuses a gzip bomb chunk by chunk, before the inflated text reaches
 *  memory whole. */
const MAX_DECODED_SAVE_BYTES = 256 * 1024 * 1024;

export function isGzipSave(bytes: Uint8Array): boolean {
  return bytes.length >= GZIP_MAGIC.length && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

export async function compressSaveText(text: string): Promise<SaveBytes> {
  const compressed = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

/** The save's JSON text from a picked or staged file, whichever envelope the bytes carry. */
export async function decodeSaveText(
  bytes: SaveBytes,
  maxDecodedBytes: number = MAX_DECODED_SAVE_BYTES,
): Promise<string> {
  if (!isGzipSave(bytes)) {
    if (bytes.byteLength > maxDecodedBytes) throw new Error(`save exceeds ${maxDecodedBytes} bytes`);
    return new TextDecoder().decode(bytes);
  }
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxDecodedBytes) {
      // Swallow the cancel result: a stream error here must not mask the cap message.
      await reader.cancel().catch(() => undefined);
      throw new Error(`save inflates past ${maxDecodedBytes} bytes`);
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}
