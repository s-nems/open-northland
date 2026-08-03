/**
 * Byte primitives shared by the decoders: every Cultures container is little-endian with the same
 * handful of reads. Deliberately domain-free, holding no storable ids or format knowledge.
 */

/**
 * A `DataView` spanning exactly `bytes` (its `byteOffset`/`byteLength`), not the whole backing buffer.
 * Callers pass `.subarray()` slices, for which a bare `new DataView(x.buffer)` would silently read from
 * the start of the shared buffer.
 */
export function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Little-endian sequential reader over a byte buffer. Throws on overrun: a corrupt container is a
 * boundary failure, not a recoverable state.
 */
export class ByteCursor {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private pos = 0;

  constructor(
    bytes: Uint8Array,
    /** Format namespace prepended to overrun/format errors (`cif`/`bmd`/`lib` …). */
    readonly prefix: string,
  ) {
    this.bytes = bytes;
    this.view = viewOf(bytes);
  }

  /** Current read position (bytes from the start of the buffer). */
  get offset(): number {
    return this.pos;
  }

  private ensure(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new Error(`${this.prefix}: read of ${n} bytes overruns buffer at offset ${this.pos}`);
    }
  }

  u32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  u8(): number {
    this.ensure(1);
    const v = this.bytes[this.pos] as number;
    this.pos += 1;
    return v;
  }

  /** Zero-copy view over the next `n` bytes (advances past them). Copy out if you intend to mutate. */
  take(n: number): Uint8Array {
    this.ensure(n);
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  /** Next `n` bytes as a latin1 string, the faithful 1:1 mapping for the containers' ASCII names. */
  ascii(n: number): string {
    return decodeLatin1(this.take(n));
  }
}

/**
 * Little-endian sequential writer that grows its backing buffer as needed, for the container encoders
 * that append fields in order without knowing the total size upfront. A serializer with a fixed on-disk
 * layout pre-sizes an exact buffer and writes at computed offsets instead.
 */
export class ByteWriter {
  private buf = new Uint8Array(256);
  private pos = 0;

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(this.buf);
    this.buf = grown;
  }

  u32(v: number): void {
    this.ensure(4);
    new DataView(this.buf.buffer).setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  /** A compact copy of exactly the written bytes (not a view over the oversized backing buffer). */
  result(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/**
 * Decodes bytes as ISO-8859-1: code point = byte value, a true 1:1 map for all 256 values, so display
 * strings survive byte-exact for `latin1ToCp1250` to re-decode to their real codepage.
 *
 * Deliberately not `new TextDecoder('latin1')`: that WHATWG label is an alias for windows-1252, which
 * remaps 0x80-0x9F (byte 0x9C becomes U+0153 'œ' instead of U+009C), silently corrupting the CP1250
 * letters ś/ź/Ś/Ź that live in that range. Node's `Buffer.toString('latin1')` is genuine byte-identity.
 */
export function decodeLatin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

/** Encodes a string as latin1 bytes (1:1 byte mapping; ASCII stays exact). Inverse of {@link decodeLatin1}. */
export function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
