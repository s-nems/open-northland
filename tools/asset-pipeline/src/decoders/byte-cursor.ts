/**
 * Shared little-endian primitives for the binary container decoders (`.cif`/`.bmd`/`.lib`/`.map`).
 *
 * Every Cultures container is little-endian with the same handful of reads (`u32`, occasional `i32`/
 * `u8`, raw byte runs, ASCII names), so they all grew a near-identical private reader class. This is
 * the one copy. It is deliberately domain-free — no storable ids, no format knowledge — so the
 * format-specific helpers (e.g. `readCMemory` in `cif.ts`) build on it without a circular import.
 */

/**
 * Little-endian sequential reader over a byte buffer. Throws on overrun — a corrupt container is a
 * boundary failure, not a recoverable state. The `prefix` tags every error with the owning format's
 * namespace (`cif:`/`bmd:`/`lib:` …), which the decoder tests assert on, so pass the format's short id.
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
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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

  i32(): number {
    this.ensure(4);
    const v = this.view.getInt32(this.pos, true);
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

  /** Next `n` bytes as a latin1 string — the faithful 1:1 mapping for the containers' ASCII names. */
  ascii(n: number): string {
    return LATIN1.decode(this.take(n));
  }
}

/**
 * Little-endian sequential writer that grows its backing buffer as needed — the write-side twin of
 * {@link ByteCursor}, shared by the container encoders that append fields in order without knowing the
 * total size upfront (`.bmd`/`.lib`). The fixed-layout serializers (`.png` big-endian, `.cur`/palette/
 * `map.dat` with reserved gaps and u16/random-access writes) pre-size an exact buffer and write at
 * computed offsets instead — a sequential writer would obscure their fixed on-disk layout.
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

  i32(v: number): void {
    this.ensure(4);
    new DataView(this.buf.buffer).setInt32(this.pos, v | 0, true);
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
 * Latin1 maps all 256 byte values 1:1, so it losslessly round-trips the containers' ASCII names and
 * the `.cif` structural keywords. (Display strings carrying Polish glyphs are actually CP1250 —
 * re-decode those at the IR layer where it matters; see `cif.ts`.)
 */
export const LATIN1 = new TextDecoder('latin1');

/** Encodes a string as latin1 bytes (1:1 byte mapping; ASCII stays exact). Inverse of {@link LATIN1}. */
export function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
