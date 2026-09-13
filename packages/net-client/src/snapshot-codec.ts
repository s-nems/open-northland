import { parseSaveGame, type SaveGame, serializeSaveGame } from '@open-northland/sim';

/** Bytes per `btoa` call where the platform has no `toBase64`: a multiple of three, so each chunk
 *  encodes on its own without padding, and well under the argument limit of `String.fromCharCode`. */
const BASE64_CHUNK_BYTES = 32_766;
const MAX_DECODED_SNAPSHOT_BYTES = 256 * 1024 * 1024;

/** The platform's own base64 pair, where it has one (Chrome 140, Node 26); it is a hundred times faster. */
interface NativeBase64 {
  toBase64?: () => string;
}
interface NativeFromBase64 {
  fromBase64?: (text: string) => Uint8Array<ArrayBuffer>;
}

export async function encodeSnapshot(save: SaveGame): Promise<string> {
  // Serialized before the first await, so ticks that run during the compression cannot reach in.
  const text = serializeSaveGame(save);
  return bytesToBase64(await gzipText(text));
}

export async function decodeSnapshot(
  bytes: string,
  maxDecodedBytes = MAX_DECODED_SNAPSHOT_BYTES,
): Promise<SaveGame> {
  return parseSaveGame(JSON.parse(await gunzipText(base64ToBytes(bytes), maxDecodedBytes)));
}

/** A body's stream rather than a `Blob`'s: a blob would copy the whole text once more first. */
function streamOf(body: string | Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  const stream = new Response(body).body;
  if (stream === null) throw new Error('a response body must stream');
  return stream;
}

async function gzipText(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const compressed = streamOf(text).pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

async function gunzipText(bytes: Uint8Array<ArrayBuffer>, maxDecodedBytes: number): Promise<string> {
  const reader = streamOf(bytes).pipeThrough(new DecompressionStream('gzip')).getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxDecodedBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`snapshot inflates past ${maxDecodedBytes} bytes`);
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as NativeBase64).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_BYTES))));
  }
  return parts.join('');
}

export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const native = (Uint8Array as NativeFromBase64).fromBase64;
  if (typeof native === 'function') return native(text);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
