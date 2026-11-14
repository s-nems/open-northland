import { Buffer, BufferUsage, Geometry, Mesh, Shader, type Texture, UniformGroup } from 'pixi.js';
import { type BloodDrop, type BloodMark, bloodDrops, GROUND_SQUASH } from '../../data/effects/blood.js';
import { frac } from '../../data/effects/random.js';
import { glProgramFor } from '../shaders/program-source.js';
import { updateByteRange } from '../world-batch/attribute-buffer.js';
import { BLOOD_GROUND_SOURCE } from './ground-shader.js';
import type { SurfaceContact } from './surfaces.js';
import type { BloodTextures } from './textures.js';

const VERTEX_FLOATS = 11;
const STRIDE = VERTEX_FLOATS * 4;
const MIN_CAPACITY = 256;
/** One ground quad's share of each buffer: vertices, position floats, attribute floats, indices. */
export const GROUND_QUAD_VERTICES = 4;
export const GROUND_QUAD_POSITION_FLOATS = GROUND_QUAD_VERTICES * 2;
export const GROUND_QUAD_DATA_FLOATS = GROUND_QUAD_VERTICES * VERTEX_FLOATS;
export const GROUND_QUAD_INDICES = 6;

/** A visible mark's quads: the store slots they sit in, and what they were written for. */
interface GroundRecord {
  readonly x: number;
  readonly y: number;
  readonly water: number;
  readonly slots: number[];
  build: number;
}

/**
 * One retained draw for all visible ground marks. A mark's quads keep their store slots while it stays
 * in view, so a membership change writes only the new marks' vertices and the index list, which holds
 * the marks' paint order. New quads take the lowest free slots; when the written span would still
 * exceed the drawn quads, the store is repacked in draw order, so an upload never outgrows the full
 * rewrite of every drawn quad.
 */
export class BloodGround {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly time = new UniformGroup({ uTime: { value: 0, type: 'f32' } });
  private positions = new Float32Array(0);
  private attributes = new Float32Array(0);
  private indices = new Uint32Array(0);
  private readonly positionBuffer = new Buffer({
    data: this.positions,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    shrinkToFit: false,
  });
  private readonly dataBuffer = new Buffer({
    data: this.attributes,
    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
    shrinkToFit: false,
  });
  private readonly indexBuffer = new Buffer({
    data: this.indices,
    usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
    shrinkToFit: false,
  });
  /** Quads drawn, in index order. */
  private count = 0;
  private build = 0;
  /** Store slots ever handed out; slots below it that no record holds sit in {@link free}. */
  private used = 0;
  /** Freed slots, a min-heap: a new quad takes the lowest, which keeps the written span short. */
  private readonly free: number[] = [];
  /** The slot range written since the last upload; `firstDirty > lastDirty` is none. */
  private firstDirty = Number.POSITIVE_INFINITY;
  private lastDirty = Number.NEGATIVE_INFINITY;
  /** Whether the stores were reallocated since the last upload. */
  private grown = false;
  private readonly records = new Map<BloodMark, GroundRecord>();

  constructor(private readonly textures: BloodTextures) {
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: this.positionBuffer, format: 'float32x2' },
        aUV: { buffer: this.dataBuffer, format: 'float32x2', stride: STRIDE, offset: 0 },
        aCentre: { buffer: this.dataBuffer, format: 'float32x2', stride: STRIDE, offset: 8 },
        aLife: { buffer: this.dataBuffer, format: 'float32x4', stride: STRIDE, offset: 16 },
        aShade: { buffer: this.dataBuffer, format: 'float32x3', stride: STRIDE, offset: 32 },
      },
      indexBuffer: this.indexBuffer,
    });
    const texture = textures.stain(0);
    const shader = new Shader({
      glProgram: glProgramFor(BLOOD_GROUND_SOURCE),
      resources: { bloodTime: this.time, uTexture: texture.source },
    });
    this.mesh = new Mesh({ geometry, shader, texture });
    this.mesh.visible = false;
  }

  get quadCount(): number {
    return this.count;
  }

  begin(): void {
    this.count = 0;
    this.build++;
  }

  add(
    mark: BloodMark,
    x: number,
    y: number,
    water: number,
    bodyRise: number,
    contacts?: readonly (SurfaceContact | undefined)[],
  ): readonly BloodDrop[] | undefined {
    if (water >= 1) return;
    const cached = this.records.get(mark);
    if (cached !== undefined && cached.x === x && cached.y === y && cached.water === water) {
      for (const slot of cached.slots) this.order(slot);
      cached.build = this.build;
      return;
    }
    if (cached !== undefined) this.release(cached);
    const record: GroundRecord = { x, y, water, slots: [], build: this.build };
    this.records.set(mark, record);
    const drops = bloodDrops(mark, bodyRise);
    const strength = mark.fatal ? 1 : mark.profile === 'blunt' ? 0.18 : mark.profile === 'pierce' ? 0.4 : 0.6;
    const scale = strength * Math.sqrt(mark.amount * mark.volume) * (0.85 + frac(mark.seed, 91) * 0.45);
    const angle = (frac(mark.seed, 90) - 0.5) * 0.5;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    this.quad(
      record,
      mark,
      this.textures.stain(mark.seed, mark.palette),
      x,
      y,
      c * scale,
      s * scale * GROUND_SQUASH,
      -s * scale,
      c * scale * GROUND_SQUASH,
      2,
      mark.fatal ? 20 : 7,
      0.55,
      1,
      water,
    );
    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      if (drop === undefined || contacts?.[i] !== undefined) continue;
      // Unsquash the velocity before rotating on the ground plane; oblique impacts leave longer marks.
      const angle = Math.atan2(drop.vy / GROUND_SQUASH, drop.vx);
      const speed = Math.hypot(drop.vx, drop.vy / GROUND_SQUASH);
      const stretch = 1 + Math.min(0.8, speed * 0.18);
      const scale = drop.size * 0.23;
      const c = Math.cos(angle),
        s = Math.sin(angle);
      this.quad(
        record,
        mark,
        this.textures.stain(mark.seed + i * 7, mark.palette),
        x + drop.vx * drop.flight,
        y + drop.vy * drop.flight,
        c * scale * stretch,
        s * scale * stretch * GROUND_SQUASH,
        (-s * scale) / Math.sqrt(stretch),
        (c * scale * GROUND_SQUASH) / Math.sqrt(stretch),
        drop.delay + drop.flight,
        1.5,
        0.17 / 0.23,
        Math.round(205 + frac(mark.seed, i + 150) * 50) / 255,
        water,
      );
    }
    return drops;
  }

  finish(): void {
    for (const [mark, record] of this.records) {
      if (record.build === this.build) continue;
      this.release(record);
      this.records.delete(mark);
    }
    if (this.records.size === 0) {
      this.used = 0;
      this.free.length = 0;
    }
    this.mesh.visible = this.count > 0;
    if (this.count === 0) return;
    this.mesh.geometry.indexCount = this.count * GROUND_QUAD_INDICES;
    if (this.lastDirty - this.firstDirty + 1 > this.count) this.compact();
    if (this.grown) {
      this.positionBuffer.data = this.positions;
      this.dataBuffer.data = this.attributes;
      this.indexBuffer.data = this.indices;
      this.grown = false;
    } else {
      if (this.firstDirty <= this.lastDirty) {
        const quads = this.lastDirty - this.firstDirty + 1;
        const positionBytes = GROUND_QUAD_POSITION_FLOATS * Float32Array.BYTES_PER_ELEMENT;
        const dataBytes = GROUND_QUAD_VERTICES * STRIDE;
        updateByteRange(this.positionBuffer, this.firstDirty * positionBytes, quads * positionBytes);
        updateByteRange(this.dataBuffer, this.firstDirty * dataBytes, quads * dataBytes);
      }
      updateByteRange(this.indexBuffer, 0, this.count * GROUND_QUAD_INDICES * Uint32Array.BYTES_PER_ELEMENT);
    }
    this.firstDirty = Number.POSITIVE_INFINITY;
    this.lastDirty = Number.NEGATIVE_INFINITY;
  }

  draw(tick: number): void {
    const time = tick % 4096;
    if (this.count === 0 || this.time.uniforms.uTime === time) return;
    this.time.uniforms.uTime = time;
    this.time.update();
  }

  clear(): void {
    this.count = 0;
    this.used = 0;
    this.free.length = 0;
    this.records.clear();
    this.mesh.visible = false;
  }

  destroy(): void {
    const { geometry, shader } = this.mesh;
    this.mesh.destroy();
    geometry.destroy(true);
    shader?.destroy();
    this.records.clear();
  }

  private quad(
    record: GroundRecord,
    mark: BloodMark,
    texture: Texture,
    x: number,
    y: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    delay: number,
    duration: number,
    minimumScale: number,
    shade: number,
    water: number,
  ): void {
    const slot = this.allocate();
    record.slots.push(slot);
    this.order(slot);
    const halfW = texture.width / 2,
      halfH = texture.height / 2;
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = texture.uvs;
    const opacity = Math.min(1, 0.25 + 0.75 * Math.sqrt(mark.amount)) * (1 - water);
    const dry = 360 + frac(mark.seed, 97) * 240;
    for (let corner = 0; corner < GROUND_QUAD_VERTICES; corner++) {
      const u = corner === 0 || corner === 3 ? -halfW : halfW;
      const v = corner < 2 ? -halfH : halfH;
      const vertex = slot * GROUND_QUAD_VERTICES + corner;
      this.positions[vertex * 2] = x + u * ax + v * bx;
      this.positions[vertex * 2 + 1] = y + u * ay + v * by;
      const at = vertex * VERTEX_FLOATS;
      this.attributes[at] = corner === 0 ? x0 : corner === 1 ? x1 : corner === 2 ? x2 : x3;
      this.attributes[at + 1] = corner === 0 ? y0 : corner === 1 ? y1 : corner === 2 ? y2 : y3;
      this.attributes[at + 2] = x;
      this.attributes[at + 3] = y;
      this.attributes[at + 4] = mark.spawnTick % 4096;
      this.attributes[at + 5] = delay;
      this.attributes[at + 6] = duration;
      this.attributes[at + 7] = minimumScale;
      this.attributes[at + 8] = opacity;
      this.attributes[at + 9] = shade;
      this.attributes[at + 10] = dry;
    }
  }

  /** Append `slot`'s quad to the draw order. */
  private order(slot: number): void {
    if ((this.count + 1) * GROUND_QUAD_INDICES > this.indices.length) this.growIndices();
    this.writeIndices(this.count, slot);
    this.count++;
  }

  /** Point draw position `quad` of the index list at `slot`'s vertices. */
  private writeIndices(quad: number, slot: number): void {
    const v = slot * GROUND_QUAD_VERTICES;
    const at = quad * GROUND_QUAD_INDICES;
    this.indices[at] = v;
    this.indices[at + 1] = v + 1;
    this.indices[at + 2] = v + 2;
    this.indices[at + 3] = v;
    this.indices[at + 4] = v + 2;
    this.indices[at + 5] = v + 3;
  }

  /** A store slot for one new quad, the lowest free one, marked for upload. */
  private allocate(): number {
    const slot = this.free.length > 0 ? this.popFree() : this.used++;
    if (slot * GROUND_QUAD_POSITION_FLOATS >= this.positions.length) this.growStore();
    this.firstDirty = Math.min(this.firstDirty, slot);
    this.lastDirty = Math.max(this.lastDirty, slot);
    return slot;
  }

  private release(record: GroundRecord): void {
    for (const slot of record.slots) this.pushFree(slot);
  }

  /**
   * Move the drawn quads to slots `[0, count)` in draw order, the layout a fresh build writes, and mark
   * them all for upload. Every record left is drawn in this build, so each slot it holds moves.
   */
  private compact(): void {
    const positions = new Float32Array(this.count * GROUND_QUAD_POSITION_FLOATS);
    const attributes = new Float32Array(this.count * GROUND_QUAD_DATA_FLOATS);
    const movedTo = new Map<number, number>();
    for (let quad = 0; quad < this.count; quad++) {
      const slot = (this.indices[quad * GROUND_QUAD_INDICES] ?? 0) / GROUND_QUAD_VERTICES;
      movedTo.set(slot, quad);
      positions.set(
        this.positions.subarray(slot * GROUND_QUAD_POSITION_FLOATS, (slot + 1) * GROUND_QUAD_POSITION_FLOATS),
        quad * GROUND_QUAD_POSITION_FLOATS,
      );
      attributes.set(
        this.attributes.subarray(slot * GROUND_QUAD_DATA_FLOATS, (slot + 1) * GROUND_QUAD_DATA_FLOATS),
        quad * GROUND_QUAD_DATA_FLOATS,
      );
      this.writeIndices(quad, quad);
    }
    this.positions.set(positions);
    this.attributes.set(attributes);
    for (const record of this.records.values()) {
      for (let i = 0; i < record.slots.length; i++) record.slots[i] = movedTo.get(record.slots[i] ?? 0) ?? 0;
    }
    this.used = this.count;
    this.free.length = 0;
    this.firstDirty = 0;
    this.lastDirty = this.count - 1;
  }

  private pushFree(slot: number): void {
    const heap = this.free;
    let i = heap.length;
    heap.push(slot);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const above = heap[parent] ?? 0;
      if (above <= slot) break;
      heap[i] = above;
      i = parent;
    }
    heap[i] = slot;
  }

  /** The lowest free slot; the heap must not be empty. */
  private popFree(): number {
    const heap = this.free;
    const lowest = heap[0] ?? 0;
    const last = heap.pop() ?? 0;
    const n = heap.length;
    if (n === 0) return lowest;
    let i = 0;
    for (;;) {
      const left = 2 * i + 1;
      if (left >= n) break;
      const right = left + 1;
      const child = right < n && (heap[right] ?? 0) < (heap[left] ?? 0) ? right : left;
      const below = heap[child] ?? 0;
      if (below >= last) break;
      heap[i] = below;
      i = child;
    }
    heap[i] = last;
    return lowest;
  }

  private growStore(): void {
    const capacity = Math.max(MIN_CAPACITY, (this.positions.length / GROUND_QUAD_POSITION_FLOATS) * 2);
    const positions = new Float32Array(capacity * GROUND_QUAD_POSITION_FLOATS);
    const attributes = new Float32Array(capacity * GROUND_QUAD_DATA_FLOATS);
    positions.set(this.positions);
    attributes.set(this.attributes);
    this.positions = positions;
    this.attributes = attributes;
    this.grown = true;
  }

  private growIndices(): void {
    const quads = Math.max(MIN_CAPACITY, (this.indices.length / GROUND_QUAD_INDICES) * 2);
    const indices = new Uint32Array(quads * GROUND_QUAD_INDICES);
    indices.set(this.indices);
    this.indices = indices;
    this.grown = true;
  }
}
