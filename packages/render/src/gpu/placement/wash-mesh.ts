import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';

/** Rim segments of an ellipse fan: under half a composite px off the true curve at the wash's radii. */
const ELLIPSE_SEGMENTS = 16;
const ELLIPSE_RIM: readonly { readonly cos: number; readonly sin: number }[] = Array.from(
  { length: ELLIPSE_SEGMENTS },
  (_, i) => {
    const angle = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
    return { cos: Math.cos(angle), sin: Math.sin(angle) };
  },
);
const INITIAL_VERTICES = 4096;
const QUAD_VERTICES = 4;
const QUAD_INDICES = 6;
const TRIANGLE_INDICES = 3;

/**
 * The triangles of one side of the placement wash, written straight into grow-only buffers. A shape per
 * node through `Graphics` re-triangulated the whole band on every recomposite, which cost more than the
 * fill it fed. Pure, so it tests without GL.
 */
export class WashGeometry {
  positions = new Float32Array(INITIAL_VERTICES * 2);
  indices = new Uint32Array(INITIAL_VERTICES * 3);
  vertexCount = 0;
  indexCount = 0;

  clear(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  /** A diamond of half-extents `hw` × `hh` about a node point. */
  diamond(cx: number, cy: number, hw: number, hh: number): void {
    this.quad(cx, cy - hh, cx + hw, cy, cx, cy + hh, cx - hw, cy);
  }

  /** A convex quad, corners in order around it. */
  quad(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): void {
    this.reserve(QUAD_VERTICES, QUAD_INDICES);
    const v = this.vertexCount;
    const { positions, indices } = this;
    let p = v * 2;
    positions[p++] = ax;
    positions[p++] = ay;
    positions[p++] = bx;
    positions[p++] = by;
    positions[p++] = cx;
    positions[p++] = cy;
    positions[p++] = dx;
    positions[p] = dy;
    let i = this.indexCount;
    indices[i++] = v;
    indices[i++] = v + 1;
    indices[i++] = v + 2;
    indices[i++] = v;
    indices[i++] = v + 2;
    indices[i] = v + 3;
    this.vertexCount += QUAD_VERTICES;
    this.indexCount += QUAD_INDICES;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number): void {
    this.reserve(ELLIPSE_SEGMENTS + 1, ELLIPSE_SEGMENTS * TRIANGLE_INDICES);
    const centre = this.vertexCount;
    let p = centre * 2;
    this.positions[p++] = cx;
    this.positions[p++] = cy;
    let i = this.indexCount;
    for (let segment = 0; segment < ELLIPSE_SEGMENTS; segment++) {
      const rim = ELLIPSE_RIM[segment];
      if (rim === undefined) continue;
      this.positions[p++] = cx + rim.cos * rx;
      this.positions[p++] = cy + rim.sin * ry;
      this.indices[i++] = centre;
      this.indices[i++] = centre + 1 + segment;
      this.indices[i++] = centre + 1 + ((segment + 1) % ELLIPSE_SEGMENTS);
    }
    this.vertexCount += ELLIPSE_SEGMENTS + 1;
    this.indexCount = i;
  }

  /**
   * The quad between two equal ellipses centred on `a` and `b`, edge to edge along their common tangents:
   * with the ellipses themselves it is the shape one of them sweeps on the way to the other.
   */
  sweep(ax: number, ay: number, bx: number, by: number, rx: number, ry: number): void {
    // In the space where the ellipse is a circle of radius `rx`, the tangent offset is the unit normal.
    const stretch = rx / ry;
    const dx = bx - ax;
    const dy = (by - ay) * stretch;
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    const ox = (-dy / length) * rx;
    const oy = (dx / length) * ry;
    this.quad(ax + ox, ay + oy, bx + ox, by + oy, bx - ox, by - oy, ax - ox, ay - oy);
  }

  private reserve(vertices: number, indices: number): void {
    if ((this.vertexCount + vertices) * 2 > this.positions.length) {
      const grown = new Float32Array(Math.max(this.positions.length * 2, (this.vertexCount + vertices) * 2));
      grown.set(this.positions);
      this.positions = grown;
    }
    if (this.indexCount + indices > this.indices.length) {
      const grown = new Uint32Array(Math.max(this.indices.length * 2, this.indexCount + indices));
      grown.set(this.indices);
      this.indices = grown;
    }
  }
}

/** A {@link WashGeometry} as a white mesh under its own host, the root an off-screen render takes: a
 *  child's blend mode is honoured there where a root's is not, and an empty side hides the child. */
export class WashMesh {
  readonly host = new Container();
  readonly shape = new WashGeometry();
  private readonly geometry = new MeshGeometry({
    positions: new Float32Array(0),
    uvs: new Float32Array(0),
    indices: new Uint32Array(0),
  });
  private readonly mesh = new Mesh({ geometry: this.geometry, texture: Texture.WHITE });
  /** Every vertex samples the white texel at the origin; grown with the positions. */
  private uvs = new Float32Array(0);

  constructor(blendMode: 'normal' | 'erase' = 'normal') {
    this.mesh.blendMode = blendMode;
    this.host.addChild(this.mesh);
  }

  /** Hand the written triangles to the GPU buffers. */
  commit(): void {
    const { shape } = this;
    this.mesh.visible = shape.indexCount > 0;
    if (this.uvs.length < shape.positions.length) this.uvs = new Float32Array(shape.positions.length);
    this.geometry.positions = shape.positions.subarray(0, shape.vertexCount * 2);
    this.geometry.uvs = this.uvs.subarray(0, shape.vertexCount * 2);
    this.geometry.indices = shape.indices.subarray(0, shape.indexCount);
  }

  destroy(): void {
    this.host.destroy({ children: true });
    this.geometry.destroy();
  }
}
