import type { Buffer, MeshGeometry } from 'pixi.js';

const RGB = 3;
/** The lattice coordinates each registered mesh vertex sits on, `(hx, hy)` pairs. */
const nodeCoordinates = new WeakMap<MeshGeometry, Int32Array>();

export function registerTerrainNodes(geometry: MeshGeometry, nodes: readonly number[]): void {
  nodeCoordinates.set(geometry, Int32Array.from(nodes));
}

interface ColorMesh {
  readonly buffer: Buffer;
  readonly colors: Float32Array;
  /** Node id per vertex, -1 for a border vertex outside the lattice. */
  readonly nodes: Int32Array;
}

/** Per node, the mesh vertices drawn on it: `entries[2 * i]` a mesh index, `entries[2 * i + 1]` the
 *  offset of its colour in that mesh's buffer, for `i` in `nodeStart[node] .. nodeStart[node + 1]`. */
interface NodeVertices {
  readonly nodeStart: Int32Array;
  readonly entries: Int32Array;
}

/**
 * The terrain's per-vertex RGB multipliers, addressed by lattice node id (`hy * nodesX + hx`). The
 * node-to-vertex index is built on the first {@link apply}, so a map without script tints pays nothing.
 */
export class TerrainVertexColors {
  private meshes: readonly ColorMesh[] = [];
  private nodeCount = 0;
  private index: NodeVertices | null = null;
  /** The multipliers last written per node; every vertex starts at neutral 1. */
  private applied = new Float32Array(0);

  bind(geometries: readonly MeshGeometry[], nodesX: number, nodesY: number): void {
    this.clear();
    this.nodeCount = nodesX * nodesY;
    const meshes: ColorMesh[] = [];
    for (const geometry of geometries) {
      const coordinates = nodeCoordinates.get(geometry);
      if (coordinates === undefined) continue;
      const buffer = geometry.getBuffer('aVertexColor');
      const colors = buffer.data;
      if (!(colors instanceof Float32Array)) continue;
      const nodes = new Int32Array(coordinates.length / 2);
      for (let v = 0; v < nodes.length; v++) {
        const hx = coordinates[2 * v] ?? -1;
        const hy = coordinates[2 * v + 1] ?? -1;
        nodes[v] = hx >= 0 && hx < nodesX && hy >= 0 && hy < nodesY ? hy * nodesX + hx : -1;
      }
      meshes.push({ buffer, colors, nodes });
    }
    this.meshes = meshes;
  }

  /**
   * Write `colors` (RGB per node id) to every vertex on a node whose multiplier differs from the last
   * applied one, and upload only the buffers that changed.
   */
  apply(colors: Float32Array): void {
    const index = this.indexed();
    const { applied } = this;
    const nodes = Math.min(this.nodeCount, Math.floor(colors.length / RGB));
    const dirty = new Set<ColorMesh>();
    for (let node = 0; node < nodes; node++) {
      const at = node * RGB;
      const r = colors[at] ?? 1;
      const g = colors[at + 1] ?? 1;
      const b = colors[at + 2] ?? 1;
      if (applied[at] === r && applied[at + 1] === g && applied[at + 2] === b) continue;
      applied[at] = r;
      applied[at + 1] = g;
      applied[at + 2] = b;
      const end = index.nodeStart[node + 1] ?? 0;
      for (let entry = index.nodeStart[node] ?? 0; entry < end; entry++) {
        const mesh = this.meshes[index.entries[2 * entry] ?? 0];
        if (mesh === undefined) continue;
        const offset = index.entries[2 * entry + 1] ?? 0;
        mesh.colors[offset] = r;
        mesh.colors[offset + 1] = g;
        mesh.colors[offset + 2] = b;
        dirty.add(mesh);
      }
    }
    for (const mesh of dirty) mesh.buffer.update();
  }

  clear(): void {
    this.meshes = [];
    this.nodeCount = 0;
    this.index = null;
    this.applied = new Float32Array(0);
  }

  private indexed(): NodeVertices {
    if (this.index !== null) return this.index;
    const nodeStart = new Int32Array(this.nodeCount + 1);
    for (const { nodes } of this.meshes) {
      for (let v = 0; v < nodes.length; v++) {
        const node = nodes[v] ?? -1;
        if (node >= 0) nodeStart[node + 1] = (nodeStart[node + 1] ?? 0) + 1;
      }
    }
    for (let node = 0; node < this.nodeCount; node++)
      nodeStart[node + 1] = (nodeStart[node + 1] ?? 0) + (nodeStart[node] ?? 0);
    const entries = new Int32Array(2 * (nodeStart[this.nodeCount] ?? 0));
    const fill = nodeStart.slice(0, this.nodeCount);
    for (let m = 0; m < this.meshes.length; m++) {
      const nodes = this.meshes[m]?.nodes ?? new Int32Array(0);
      for (let v = 0; v < nodes.length; v++) {
        const node = nodes[v] ?? -1;
        if (node < 0) continue;
        const entry = fill[node] ?? 0;
        fill[node] = entry + 1;
        entries[2 * entry] = m;
        entries[2 * entry + 1] = v * RGB;
      }
    }
    this.applied = new Float32Array(this.nodeCount * RGB).fill(1);
    this.index = { nodeStart, entries };
    return this.index;
  }
}
