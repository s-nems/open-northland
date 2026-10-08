import { Buffer, BufferUsage, Geometry, Mesh, Shader, type Texture, UniformGroup } from 'pixi.js';
import { type BloodDrop, type BloodMark, bloodDrops, GROUND_SQUASH } from '../../data/effects/blood.js';
import { frac } from '../../data/effects/random.js';
import { glProgramFor } from '../program-source.js';
import { BLOOD_GROUND_SOURCE } from './blood-ground-shader.js';
import type { BloodTextures } from './blood-textures.js';

const VERTICES = 4;
const DATA_FLOATS = 11;
const STRIDE = DATA_FLOATS * 4;

/** One retained draw for all visible ground marks; only membership/terrain changes repack its quads. */
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
  private count = 0;
  private build = 0;
  private readonly records = new Map<
    BloodMark,
    { x: number; y: number; water: number; positions: Float32Array; attributes: Float32Array; build: number }
  >();

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
  ): readonly BloodDrop[] | undefined {
    if (water >= 1) return;
    const cached = this.records.get(mark);
    if (cached !== undefined && cached.x === x && cached.y === y && cached.water === water) {
      const quads = cached.positions.length / (VERTICES * 2);
      this.reserve(this.count + quads);
      this.positions.set(cached.positions, this.count * VERTICES * 2);
      this.attributes.set(cached.attributes, this.count * VERTICES * DATA_FLOATS);
      this.count += quads;
      cached.build = this.build;
      return;
    }
    const start = this.count;
    const drops = bloodDrops(mark, bodyRise);
    const strength = mark.fatal ? 1 : mark.profile === 'blunt' ? 0.18 : mark.profile === 'pierce' ? 0.4 : 0.6;
    const scale = strength * Math.sqrt(mark.amount) * (0.85 + frac(mark.seed, 91) * 0.45);
    const angle = (frac(mark.seed, 90) - 0.5) * 0.5;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    this.quad(
      mark,
      this.textures.stain(mark.seed),
      x,
      y,
      c * scale,
      s * scale,
      -s * scale * GROUND_SQUASH,
      c * scale * GROUND_SQUASH,
      2,
      mark.fatal ? 20 : 7,
      0.55,
      1,
      water,
    );
    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i];
      if (drop === undefined) continue;
      const angle = frac(mark.seed, 110 + i) * Math.PI * 2;
      const scale = drop.size * 0.23;
      const c = Math.cos(angle),
        s = Math.sin(angle);
      this.quad(
        mark,
        this.textures.stain(mark.seed + i * 7),
        x + drop.vx * drop.flight,
        y + drop.vy * drop.flight,
        c * scale,
        s * scale * GROUND_SQUASH,
        -s * scale,
        c * scale * GROUND_SQUASH,
        drop.delay + drop.flight,
        1.5,
        0.17 / 0.23,
        Math.round(205 + frac(mark.seed, i + 150) * 50) / 255,
        water,
      );
    }
    this.records.set(mark, {
      x,
      y,
      water,
      build: this.build,
      positions: this.positions.slice(start * VERTICES * 2, this.count * VERTICES * 2),
      attributes: this.attributes.slice(start * VERTICES * DATA_FLOATS, this.count * VERTICES * DATA_FLOATS),
    });
    return drops;
  }

  finish(): void {
    for (const [mark, record] of this.records) if (record.build !== this.build) this.records.delete(mark);
    this.mesh.visible = this.count > 0;
    if (this.count === 0) return;
    this.mesh.geometry.indexCount = this.count * 6;
    this.positionBuffer.setDataWithSize(this.positions, this.count * VERTICES * 2, true);
    this.dataBuffer.setDataWithSize(this.attributes, this.count * VERTICES * DATA_FLOATS, true);
    if (this.indexBuffer.data !== this.indices) this.indexBuffer.data = this.indices;
  }

  draw(tick: number): void {
    const time = tick % 4096;
    if (this.count === 0 || this.time.uniforms.uTime === time) return;
    this.time.uniforms.uTime = time;
    this.time.update();
  }

  clear(): void {
    this.count = 0;
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
    this.reserve(this.count + 1);
    const halfW = texture.width / 2,
      halfH = texture.height / 2;
    const { x0, y0, x1, y1, x2, y2, x3, y3 } = texture.uvs;
    const opacity = (0.25 + 0.75 * Math.sqrt(mark.amount)) * (1 - water);
    const dry = 360 + frac(mark.seed, 97) * 240;
    for (let corner = 0; corner < VERTICES; corner++) {
      const u = corner === 0 || corner === 3 ? -halfW : halfW;
      const v = corner < 2 ? -halfH : halfH;
      const vertex = this.count * VERTICES + corner;
      this.positions[vertex * 2] = x + u * ax + v * bx;
      this.positions[vertex * 2 + 1] = y + u * ay + v * by;
      const at = vertex * DATA_FLOATS;
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
    this.count++;
  }

  private reserve(count: number): void {
    if (count * 6 <= this.indices.length) return;
    const capacity = Math.max(256, count, this.indices.length / 3);
    const positions = new Float32Array(capacity * VERTICES * 2);
    const attributes = new Float32Array(capacity * VERTICES * DATA_FLOATS);
    const indices = new Uint32Array(capacity * 6);
    positions.set(this.positions);
    attributes.set(this.attributes);
    for (let i = 0; i < capacity; i++) {
      const v = i * VERTICES;
      const at = i * 6;
      indices[at] = v;
      indices[at + 1] = v + 1;
      indices[at + 2] = v + 2;
      indices[at + 3] = v;
      indices[at + 4] = v + 2;
      indices[at + 5] = v + 3;
    }
    this.positions = positions;
    this.attributes = attributes;
    this.indices = indices;
  }
}
