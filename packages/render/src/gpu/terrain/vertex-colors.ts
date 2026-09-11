import type { Buffer, MeshGeometry } from 'pixi.js';

export interface TerrainVertexColor {
  readonly hx: number;
  readonly hy: number;
  readonly value: number;
}

const NEUTRAL_COLOR = 0x808080;
// Approximation: vertexcolors.pcx channels use 128 as neutral and multiply the existing ground shade.
const NEUTRAL_CHANNEL = 128;
const BUCKET_NODES = 64;
const nodeCoordinates = new WeakMap<MeshGeometry, Int32Array>();

export function registerTerrainNodes(geometry: MeshGeometry, nodes: readonly number[]): void {
  nodeCoordinates.set(geometry, Int32Array.from(nodes));
}

interface ColorMesh {
  readonly buffer: Buffer;
  readonly colors: Float32Array;
  readonly nodes: Int32Array;
  offsets: ReadonlyMap<string, readonly number[]> | null;
}

function offsetsFor(mesh: ColorMesh): ReadonlyMap<string, readonly number[]> {
  if (mesh.offsets !== null) return mesh.offsets;
  const offsets = new Map<string, number[]>();
  for (let i = 0; i < mesh.nodes.length; i += 2) {
    const key = `${mesh.nodes[i]},${mesh.nodes[i + 1]}`;
    let list = offsets.get(key);
    if (list === undefined) {
      list = [];
      offsets.set(key, list);
    }
    list.push((i / 2) * 3);
  }
  mesh.offsets = offsets;
  return offsets;
}

export class TerrainVertexColors {
  private readonly buckets = new Map<string, ColorMesh[]>();
  private readonly values = new Map<string, number>();
  private palette: readonly number[] | undefined;

  bind(geometry: MeshGeometry): void {
    const nodes = nodeCoordinates.get(geometry);
    if (nodes === undefined) return;
    const buffer = geometry.getBuffer('aVertexColor');
    const colors = buffer.data;
    if (!(colors instanceof Float32Array)) return;
    const keys = new Set<string>();
    for (let i = 0; i < nodes.length; i += 2) {
      keys.add(
        `${Math.floor((nodes[i] ?? 0) / BUCKET_NODES)},${Math.floor((nodes[i + 1] ?? 0) / BUCKET_NODES)}`,
      );
    }
    const mesh: ColorMesh = { buffer, colors, nodes, offsets: null };
    for (const key of keys) {
      let bucket = this.buckets.get(key);
      if (bucket === undefined) {
        bucket = [];
        this.buckets.set(key, bucket);
      }
      bucket.push(mesh);
    }
  }

  apply(updates: readonly TerrainVertexColor[], palette?: readonly number[]): void {
    const dirty = new Set<Buffer>();
    const write = (key: string, value: number): void => {
      const [hx = 0, hy = 0] = key.split(',').map(Number);
      const meshes = this.buckets.get(`${Math.floor(hx / BUCKET_NODES)},${Math.floor(hy / BUCKET_NODES)}`);
      const color = palette?.[value] ?? NEUTRAL_COLOR;
      const r = ((color >>> 16) & 255) / NEUTRAL_CHANNEL;
      const g = ((color >>> 8) & 255) / NEUTRAL_CHANNEL;
      const b = (color & 255) / NEUTRAL_CHANNEL;
      for (const mesh of meshes ?? []) {
        const { colors } = mesh;
        for (const offset of offsetsFor(mesh).get(key) ?? []) {
          if (colors[offset] === r && colors[offset + 1] === g && colors[offset + 2] === b) continue;
          colors[offset] = r;
          colors[offset + 1] = g;
          colors[offset + 2] = b;
          dirty.add(mesh.buffer);
        }
      }
    };
    if (this.palette !== palette) {
      this.palette = palette;
      for (const [key, value] of this.values) write(key, value);
    }
    for (const { hx, hy, value } of updates) {
      if (
        !Number.isInteger(hx) ||
        !Number.isInteger(hy) ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255
      )
        continue;
      const key = `${hx},${hy}`;
      if (this.values.get(key) === value) continue;
      this.values.set(key, value);
      write(key, value);
    }
    for (const buffer of dirty) buffer.update();
  }

  clear(): void {
    this.buckets.clear();
    this.values.clear();
    this.palette = undefined;
  }
}
