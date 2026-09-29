import { Container, type TextureSource } from 'pixi.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import {
  type Barycentric,
  cellsNearNode,
  type HalfTriangle,
  halfTrianglesA,
  halfTrianglesB,
  nodeLaneUV,
  ROAD_GROUND_PATTERN,
  ROAD_TRANSITIONS,
  roadPaintOf,
  triangleANodes,
  triangleBNodes,
  triangleRoadNodes,
  triangleUVs,
} from '../../data/terrain/index.js';
import { destroyMeshChildren } from '../mesh-teardown.js';
import type { TerrainTextureSet } from '../terrain-textures.js';
import { ChunkBatcher, type TerrainBatch } from './chunk-batcher.js';
import {
  type LaneShading,
  type NodeLiftFn,
  positions,
  TERRAIN_CHUNK_TILES,
  type TerrainChunk,
} from './geometry.js';

/** One resolved road texture: its page and the pattern's `coordsA`/`coordsB` point tuples, one per pair
 *  for a transition and a single pair for the ground pattern. */
interface RoadTexture {
  readonly pageKey: string;
  readonly source: TextureSource;
  readonly coordsA: readonly (readonly number[])[];
  readonly coordsB: readonly (readonly number[])[];
}

interface RoadTextures {
  readonly ground: RoadTexture;
  readonly edges: readonly [RoadTexture, RoadTexture];
}

type TriangleKind = 'a' | 'b';

/** A ground triangle: its cell and which of the cell's two. */
interface TriangleRef {
  readonly col: number;
  readonly row: number;
  readonly which: TriangleKind;
}

function resolveRoadTextures(textures: TerrainTextureSet): RoadTextures | null {
  const ground = textures.groundFor?.(ROAD_GROUND_PATTERN);
  const groundSource = ground === undefined ? undefined : textures.pages.get(ground.pageKey);
  if (ground === undefined || groundSource === undefined) return null;
  const edges: RoadTexture[] = [];
  for (const name of ROAD_TRANSITIONS) {
    const t = textures.transitionFor?.(name);
    const source = t === undefined ? undefined : textures.pages.get(t.pageKey);
    if (t === undefined || source === undefined) return null;
    edges.push({ pageKey: t.pageKey, source, coordsA: t.coordsA, coordsB: t.coordsB });
  }
  const [edge1, edge2] = edges;
  if (edge1 === undefined || edge2 === undefined) return null;
  return {
    ground: {
      pageKey: ground.pageKey,
      source: groundSource,
      coordsA: [ground.coordsA],
      coordsB: [ground.coordsB],
    },
    edges: [edge1, edge2],
  };
}

function weighted(values: readonly number[], stride: number, w: Barycentric, offset: number): number {
  return (
    (values[offset] ?? 0) * w[0] +
    (values[stride + offset] ?? 0) * w[1] +
    (values[2 * stride + offset] ?? 0) * w[2]
  );
}

/**
 * The finished roads painted over the ground: one mesh set per terrain block holding roads, drawn as that
 * block's last child so the block's cull hides it. A change re-meshes only the blocks its nodes touch.
 * Script vertex colours do not tint the road (an approximation).
 */
export class RoadLayer {
  private readonly roads = new Set<number>();
  /** Road nodes per block key whose triangles lie in that block. */
  private readonly byChunk = new Map<number, Set<number>>();
  private readonly meshes = new Map<number, Container>();
  private readonly chunkByKey = new Map<number, TerrainChunk>();
  private readonly nodeWidth: number;
  private readonly chunkColumns: number;

  private constructor(
    private readonly terrain: SceneTerrain,
    private readonly textures: RoadTextures,
    private readonly lift: NodeLiftFn,
    private readonly lane: LaneShading,
    chunks: readonly TerrainChunk[],
  ) {
    this.nodeWidth = 2 * terrain.width;
    this.chunkColumns = Math.ceil(terrain.width / TERRAIN_CHUNK_TILES);
    for (const chunk of chunks) this.chunkByKey.set(this.chunkKeyOf(chunk.c0, chunk.r0), chunk);
  }

  /** Null when the loaded set lacks a road pattern or its page, which draws no roads. */
  static create(
    terrain: SceneTerrain,
    textures: TerrainTextureSet,
    lift: NodeLiftFn,
    lane: LaneShading,
    chunks: readonly TerrainChunk[],
  ): RoadLayer | null {
    const resolved = resolveRoadTextures(textures);
    return resolved === null ? null : new RoadLayer(terrain, resolved, lift, lane, chunks);
  }

  /** Replace the road set with `nodes` (half-cell row-major ids), re-meshing the blocks that changed. */
  setRoads(nodes: Iterable<number>): void {
    const next = new Set(nodes);
    const dirty = new Set<number>();
    for (const id of this.roads) {
      if (!next.has(id)) this.move(id, false, dirty);
    }
    for (const id of next) {
      if (!this.roads.has(id)) this.move(id, true, dirty);
    }
    for (const key of dirty) this.remesh(key);
  }

  destroy(): void {
    for (const container of this.meshes.values()) {
      destroyMeshChildren(container);
      container.destroy({ children: true });
    }
    this.meshes.clear();
    this.byChunk.clear();
    this.roads.clear();
  }

  private chunkKeyOf(col: number, row: number): number {
    return Math.floor(row / TERRAIN_CHUNK_TILES) * this.chunkColumns + Math.floor(col / TERRAIN_CHUNK_TILES);
  }

  private inGrid(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.terrain.width && row < this.terrain.height;
  }

  /** The ground triangles whose half triangles `id`'s node is a corner of. */
  private trianglesOf(id: number): TriangleRef[] {
    const hx = id % this.nodeWidth;
    const hy = Math.floor(id / this.nodeWidth);
    const out: TriangleRef[] = [];
    for (const [col, row] of cellsNearNode(hx, hy)) {
      if (!this.inGrid(col, row)) continue;
      for (const which of ['a', 'b'] as const) {
        if (triangleRoadNodes(col, row, which).some(([x, y]) => x === hx && y === hy)) {
          out.push({ col, row, which });
        }
      }
    }
    return out;
  }

  private move(id: number, laid: boolean, dirty: Set<number>): void {
    if (laid) this.roads.add(id);
    else this.roads.delete(id);
    for (const { col, row } of this.trianglesOf(id)) {
      const key = this.chunkKeyOf(col, row);
      dirty.add(key);
      let bucket = this.byChunk.get(key);
      if (laid) {
        if (bucket === undefined) {
          bucket = new Set();
          this.byChunk.set(key, bucket);
        }
        bucket.add(id);
      } else {
        bucket?.delete(id);
        if (bucket?.size === 0) this.byChunk.delete(key);
      }
    }
  }

  private roadAt = (hx: number, hy: number): number | undefined => {
    if (hx < 0 || hy < 0 || hx >= this.nodeWidth) return undefined;
    const id = hy * this.nodeWidth + hx;
    return this.roads.has(id) ? id : undefined;
  };

  private remesh(key: number): void {
    const old = this.meshes.get(key);
    if (old !== undefined) {
      destroyMeshChildren(old);
      old.destroy({ children: true });
      this.meshes.delete(key);
    }
    const chunk = this.chunkByKey.get(key);
    const nodes = this.byChunk.get(key);
    if (chunk === undefined || nodes === undefined) return;
    const triangles = new Map<string, TriangleRef>();
    for (const id of nodes) {
      for (const ref of this.trianglesOf(id)) {
        if (this.chunkKeyOf(ref.col, ref.row) === key)
          triangles.set(`${ref.col},${ref.row},${ref.which}`, ref);
      }
    }
    const batcher = new ChunkBatcher(this.lane.brightnessTex, this.lane.waveUniforms);
    for (const ref of triangles.values()) this.paintTriangle(batcher, ref);
    const container = new Container();
    for (const child of batcher.children()) container.addChild(child);
    chunk.container.addChild(container);
    this.meshes.set(key, container);
  }

  private paintTriangle(batcher: ChunkBatcher, { col, row, which }: TriangleRef): void {
    const corners = which === 'a' ? triangleANodes(col, row) : triangleBNodes(col, row);
    const cornerPositions = positions(corners, this.lift);
    const shaded = this.lane.brightnessTex !== undefined;
    const cornerLaneUVs = shaded
      ? corners.flatMap(([hx, hy]) =>
          nodeLaneUV(hx, hy, this.terrain.width, this.terrain.height, this.lane.laneTexWidth),
        )
      : [];
    const halves = which === 'a' ? halfTrianglesA(col, row) : halfTrianglesB(col, row);
    for (const half of halves) {
      const paint = roadPaintOf(half, this.roadAt);
      if (paint.kind === 'none') continue;
      const texture = paint.kind === 'ground' ? this.textures.ground : this.textures.edges[paint.variant];
      const pair = paint.kind === 'ground' ? 0 : paint.pair;
      const coords = (half.which === 'a' ? texture.coordsA : texture.coordsB)[pair];
      if (coords === undefined) continue;
      const batch = batcher.batchFor(texture.pageKey, texture.source, 'overlay1');
      pushHalf(
        batch,
        half,
        cornerPositions,
        cornerLaneUVs,
        triangleUVs(coords, texture.source.width, texture.source.height),
      );
    }
  }
}

function pushHalf(
  batch: TerrainBatch,
  half: HalfTriangle,
  cornerPositions: readonly number[],
  cornerLaneUVs: readonly number[],
  uvs: readonly number[],
): void {
  const base = batch.positions.length / 2;
  for (const [i, w] of half.weights.entries()) {
    batch.positions.push(weighted(cornerPositions, 2, w, 0), weighted(cornerPositions, 2, w, 1));
    const [hx, hy] = half.nodes[i] ?? [0, 0];
    batch.nodes.push(hx, hy);
    if (cornerLaneUVs.length > 0) {
      batch.brightnessUVs.push(weighted(cornerLaneUVs, 2, w, 0), weighted(cornerLaneUVs, 2, w, 1));
      // The road is land paint: no wave and no water shading.
      batch.waves.push(0);
      batch.water.push(0, 0);
    }
  }
  batch.uvs.push(...uvs);
  batch.indices.push(base, base + 1, base + 2);
}
