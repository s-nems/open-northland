import { Buffer, BufferUsage } from 'pixi.js';
import { WORLD_VERTEX_SIZE } from '../world-batcher.js';

const VERTICES_PER_QUAD = 4;
/** World-vertex floats one quad slot holds. */
export const QUAD_FLOATS = VERTICES_PER_QUAD * WORLD_VERTEX_SIZE;
const QUAD_BYTES = QUAD_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const INITIAL_QUADS = 1024;
/** Dirty slots this close are uploaded as one range: a few idle quads re-sent cost less than a call. */
const MERGE_GAP_QUADS = 8;
/** Past this many separate ranges a flush uploads their union in one call. */
const MAX_RANGES = 16;

/** Upload `size` bytes of `buffer` from `offset` to the GPU now. */
export type ByteUploader = (buffer: Buffer, offset: number, size: number) => void;

/**
 * World-vertex quads in stable slots of one growable attribute buffer, which every band geometry of the
 * still mesh shares. A slot keeps its place while its sprite stays meshed, so a band rebuild rewrites
 * indices, not vertices; only the slots whose sprite changed are packed and uploaded again.
 */
export class QuadStore {
  f32: Float32Array;
  u32: Uint32Array;
  readonly buffer: Buffer;
  private readonly free: number[] = [];
  private highWater = 0;
  private readonly dirty: number[] = [];
  /** Whether a growth swapped the data since the last flush; the next upload then sends all of it. */
  private grown = false;

  constructor(initialQuads = INITIAL_QUADS) {
    this.f32 = new Float32Array(initialQuads * QUAD_FLOATS);
    this.u32 = new Uint32Array(this.f32.buffer);
    this.buffer = new Buffer({
      data: this.f32,
      label: 'still-mesh-attributes',
      usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
      shrinkToFit: false,
    });
  }

  get capacity(): number {
    return this.f32.length / QUAD_FLOATS;
  }

  /** Slots in use. */
  get size(): number {
    return this.highWater - this.free.length;
  }

  /** A free slot, the most recently released first. */
  allocate(): number {
    const reused = this.free.pop();
    if (reused !== undefined) return reused;
    if (this.highWater === this.capacity) this.grow();
    return this.highWater++;
  }

  release(slot: number): void {
    this.free.push(slot);
  }

  /** The float index a slot's first vertex starts at. */
  static start(slot: number): number {
    return slot * QUAD_FLOATS;
  }

  markDirty(slot: number): void {
    this.dirty.push(slot);
  }

  /** Upload every slot packed since the last flush, merged into a few byte ranges. */
  flush(upload: ByteUploader): void {
    if (this.grown) {
      this.grown = false;
      this.dirty.length = 0;
      upload(this.buffer, 0, this.f32.byteLength);
      return;
    }
    if (this.dirty.length === 0) return;
    const slots = this.dirty.sort((a, b) => a - b);
    const ranges: number[] = [];
    let first = slots[0] ?? 0;
    let last = first;
    for (const slot of slots) {
      if (slot - last > MERGE_GAP_QUADS) {
        ranges.push(first, last);
        first = slot;
      }
      last = slot;
    }
    ranges.push(first, last);
    this.dirty.length = 0;
    if (ranges.length / 2 > MAX_RANGES) {
      const from = ranges[0] ?? 0;
      const to = ranges[ranges.length - 1] ?? from;
      upload(this.buffer, from * QUAD_BYTES, (to - from + 1) * QUAD_BYTES);
      return;
    }
    for (let i = 0; i < ranges.length; i += 2) {
      const from = ranges[i] ?? 0;
      const to = ranges[i + 1] ?? from;
      upload(this.buffer, from * QUAD_BYTES, (to - from + 1) * QUAD_BYTES);
    }
  }

  destroy(): void {
    this.buffer.destroy();
  }

  private grow(): void {
    const f32 = new Float32Array(this.f32.length * 2);
    f32.set(this.f32);
    this.f32 = f32;
    this.u32 = new Uint32Array(f32.buffer);
    this.buffer.data = f32;
    this.grown = true;
  }
}
