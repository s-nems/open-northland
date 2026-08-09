/**
 * zlib streams through the Web Streams compression API, the one implementation Node and browsers
 * share, so the conversion runs identically under the CLI, the desktop shell, and a web worker.
 */

async function through(
  bytes: Uint8Array,
  transform: ReadableWritablePair<Uint8Array<ArrayBuffer>, BufferSource>,
): Promise<Uint8Array> {
  const source: ReadableStream<BufferSource> = new Blob([bytes as BlobPart]).stream();
  const stream = source.pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** zlib-wrapped deflate (RFC 1950). */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new CompressionStream('deflate'));
}

/** Inverse of {@link deflate}. */
export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream('deflate'));
}
