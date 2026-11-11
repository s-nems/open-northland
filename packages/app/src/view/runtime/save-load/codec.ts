/**
 * The gzip envelope around a serialized save. Canonical JSON text stays the format and determinism
 * contract; compression is transport only, and a plain-JSON file stays loadable through the same
 * decode seam via the magic-byte sniff.
 */

import {
  type SaveGame,
  type SaveGameHeader,
  serializeSaveGame,
  serializeSaveGameParts,
} from '@open-northland/sim';

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

/** A captured save as its file bytes, with the header the slot list shows. */
export interface SaveFile {
  readonly header: SaveGameHeader;
  readonly bytes: SaveBytes;
}

/** Serialize and compress a capture. Serialized before the first await, so later ticks cannot reach in. */
export function saveFileOf(save: SaveGame): Promise<SaveFile> {
  const text = serializeSaveGame(save);
  return compressSaveText(text).then((bytes) => ({ header: save.header, bytes }));
}

/** The longest a {@link saveFileOfDetached} serializes before it pauses, in milliseconds: a fraction
 *  of a tick, so a sim stepping on the same thread keeps its clock. */
const SERIALIZE_SLICE_MS = 4;

/** The most text {@link saveFileOfDetached} hands the compressor in one turn, in bytes: the deflate runs
 *  on the calling thread inside the write, a few milliseconds for this much. */
const COMPRESS_CHUNK_BYTES = 256 * 1024;

/**
 * {@link saveFileOf} for a capture nothing else can reach, as `exportSaveGame` returns it: serialized and
 * compressed a slice at a time with `pause` awaited between slices, so the thread that captured it is
 * held for the capture alone and not for the megabytes of text after it. The bytes inflate to the text
 * {@link saveFileOf} compresses.
 */
export async function saveFileOfDetached(save: SaveGame, pause: () => Promise<void>): Promise<SaveFile> {
  const gzip = new CompressionStream('gzip');
  // Read from the start: a compressor nobody reads holds its writes back.
  const compressed = new Response(gzip.readable).arrayBuffer();
  const writer = gzip.writable.getWriter();
  const encoder = new TextEncoder();
  const compress = async (slice: readonly string[]): Promise<void> => {
    const bytes = encoder.encode(slice.join(''));
    for (let at = 0; at < bytes.length; at += COMPRESS_CHUNK_BYTES) {
      await writer.write(bytes.subarray(at, at + COMPRESS_CHUNK_BYTES));
      await pause();
    }
  };
  let slice: string[] = [];
  let sliceStartMs = performance.now();
  for (const part of serializeSaveGameParts(save)) {
    slice.push(part);
    if (performance.now() - sliceStartMs < SERIALIZE_SLICE_MS) continue;
    await pause();
    await compress(slice);
    slice = [];
    sliceStartMs = performance.now();
  }
  await compress(slice);
  await writer.close();
  return { header: save.header, bytes: new Uint8Array(await compressed) };
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

/** Decode save text to its JSON document, tolerating an editor-added BOM. The one parse seam shared
 *  by the file picker, the staged boot and the sim worker, so a file accepted by one cannot fail
 *  another's parse. */
export function saveDocumentOf(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}
