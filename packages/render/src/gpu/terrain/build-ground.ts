import type { Container, TextureSource } from 'pixi.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import {
  type BrightnessField,
  type ElevationField,
  type NodeXY,
  nodeLaneUV,
  rectTriangleUVs,
  TRANSITION_NONE,
  transitionRef,
  triangleANodes,
  triangleBNodes,
  triangleUVs,
} from '../../data/terrain/index.js';
import type { GroundPattern, TerrainTextureSet } from '../terrain-textures.js';
import { ChunkBatcher, type TerrainBatch, type TerrainLayerKind } from './chunk-batcher.js';
import {
  buildChunks,
  DEFAULT_TILE_COLOUR,
  flatTileColour,
  type LaneShading,
  liftFn,
  type NodeLiftFn,
  positions,
  type TerrainChunk,
} from './geometry.js';

/**
 * The textured terrain emitters. A decoded map's 1:1 `ground` lanes take the exact path; the per-typeId
 * path is an approximation kept for synthetic grids.
 */

interface ResolvedTransition {
  readonly pageKey: string;
  readonly source: TextureSource;
  readonly coordsA: readonly (readonly number[])[];
  readonly coordsB: readonly (readonly number[])[];
}

function pushTriangle(
  batch: TerrainBatch,
  nodes: readonly [NodeXY, NodeXY, NodeXY],
  uvs: readonly number[],
  lift: NodeLiftFn,
  terrain: SceneTerrain,
  lane: LaneShading,
): void {
  const base = batch.positions.length / 2;
  batch.positions.push(...positions(nodes, lift));
  for (const [hx, hy] of nodes) batch.nodes.push(hx, hy);
  batch.uvs.push(...uvs);
  if (lane.brightnessTex !== undefined) {
    for (const [hx, hy] of nodes) {
      batch.brightnessUVs.push(...nodeLaneUV(hx, hy, terrain.width, terrain.height, lane.laneTexWidth));
      batch.waves.push(lane.wave(hx, hy));
    }
  }
  batch.indices.push(base, base + 1, base + 2);
}

/** One batched mesh per texture page per draw layer plus a fallback trace for unbound triangles, per
 *  block - built once from the grid, so the layer's cull can skip off-screen ground. */
export function buildTextured(
  parent: Container,
  terrain: SceneTerrain,
  textures: TerrainTextureSet,
  elevation: ElevationField,
  brightness: BrightnessField,
  lane: LaneShading,
): TerrainChunk[] {
  if (terrain.ground !== undefined && textures.groundFor !== undefined) {
    return buildGround(parent, terrain, terrain.ground, textures, elevation, brightness, lane);
  }
  const lift = liftFn(terrain, elevation);
  const shaded = lane.brightnessTex !== undefined;
  return buildChunks(parent, terrain, elevation.maxLift, (c0, r0, c1, r1) => {
    const batcher = new ChunkBatcher(lane.brightnessTex, lane.waveUniforms);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const typeId = terrain.typeIds[row * terrain.width + col] ?? -1;
        const cellTex = textures.cellFor(typeId);
        const source = cellTex !== undefined ? textures.pages.get(cellTex.pageKey) : undefined;
        const triangles = [triangleANodes(col, row), triangleBNodes(col, row)] as const;
        if (cellTex === undefined || source === undefined) {
          for (const nodes of triangles) {
            batcher.drawFallbackTriangle(
              positions(nodes, lift),
              nodes,
              // Unbound typeId → the flat class colour `buildFlat` uses, so a synthetic grid's nav
              // classes still read as grass/water/sand. A textured cell never reaches here.
              cellTex?.fallbackColour ?? flatTileColour(typeId),
              shaded ? brightness.brightnessAt(col, row) : 1,
            );
          }
          continue;
        }
        const batch = batcher.batchFor(cellTex.pageKey, source);
        for (const [t, nodes] of triangles.entries()) {
          pushTriangle(
            batch,
            nodes,
            rectTriangleUVs(cellTex.rect, t === 0 ? 'a' : 'b', source.width, source.height),
            lift,
            terrain,
            lane,
          );
        }
      }
    }
    return batcher.children();
  });
}

/**
 * The 1:1 per-triangle ground: each cell's two triangles draw the {@link GroundPattern} the decoded map
 * baked into its `empa`/`empb` lanes, plus the `emt1..emt4` transition overlays as translucent RGBA
 * triangles.
 */
function buildGround(
  parent: Container,
  terrain: SceneTerrain,
  ground: NonNullable<SceneTerrain['ground']>,
  textures: TerrainTextureSet,
  elevation: ElevationField,
  brightness: BrightnessField,
  lane: LaneShading,
): TerrainChunk[] {
  // Resolve the map's compact pattern list once (index-aligned); nulls fall back per triangle.
  const resolved: ({ source: TextureSource; pageKey: string; pattern: GroundPattern } | null)[] =
    ground.patterns.map((name) => {
      const pattern = textures.groundFor?.(name);
      if (pattern === undefined) return null;
      const source = textures.pages.get(pattern.pageKey);
      if (source === undefined) return null;
      return { source, pageKey: pattern.pageKey, pattern };
    });
  // Resolve the map's transition dictionary once (index-aligned). A name the IR lacks, or a page that
  // failed to load, resolves null and that overlay is skipped.
  const transitions = terrain.transitions;
  const resolvedTransitions: (ResolvedTransition | null)[] = (transitions?.types ?? []).map((name) => {
    const t = textures.transitionFor?.(name);
    if (t === undefined) return null;
    const source = textures.pages.get(t.pageKey);
    if (source === undefined) return null;
    return { pageKey: t.pageKey, source, coordsA: t.coordsA, coordsB: t.coordsB };
  });
  const lift = liftFn(terrain, elevation);
  const shaded = lane.brightnessTex !== undefined;
  return buildChunks(parent, terrain, elevation.maxLift, (c0, r0, c1, r1) => {
    const batcher = new ChunkBatcher(lane.brightnessTex, lane.waveUniforms);
    const pushOverlay = (
      laneValue: number,
      nodes: readonly [NodeXY, NodeXY, NodeXY],
      which: 'a' | 'b',
      layer: TerrainLayerKind,
    ): void => {
      const ref = transitionRef(laneValue);
      if (ref === undefined) return;
      const t = resolvedTransitions[ref.transition] ?? null;
      if (t === null) return;
      const coords = (which === 'a' ? t.coordsA : t.coordsB)[ref.pair];
      if (coords === undefined) return;
      pushTriangle(
        batcher.batchFor(t.pageKey, t.source, layer),
        nodes,
        triangleUVs(coords, t.source.width, t.source.height),
        lift,
        terrain,
        lane,
      );
    };
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const cell = row * terrain.width + col;
        const nodesA = triangleANodes(col, row);
        const nodesB = triangleBNodes(col, row);
        const a = resolved[ground.a[cell] ?? -1] ?? null;
        const b = resolved[ground.b[cell] ?? -1] ?? null;
        for (const [entry, nodes, which] of [
          [a, nodesA, 'a'],
          [b, nodesB, 'b'],
        ] as const) {
          if (entry === null) {
            const typeId = terrain.typeIds[cell] ?? -1;
            batcher.drawFallbackTriangle(
              positions(nodes, lift),
              nodes,
              textures.cellFor(typeId)?.fallbackColour ?? DEFAULT_TILE_COLOUR,
              shaded ? brightness.brightnessAt(col, row) : 1,
            );
            continue;
          }
          pushTriangle(
            batcher.batchFor(entry.pageKey, entry.source),
            nodes,
            triangleUVs(
              which === 'a' ? entry.pattern.coordsA : entry.pattern.coordsB,
              entry.source.width,
              entry.source.height,
            ),
            lift,
            terrain,
            lane,
          );
        }
        if (transitions !== undefined) {
          // Paint order lives in the batcher's layer buckets, so push order here is immaterial.
          pushOverlay(transitions.a1[cell] ?? TRANSITION_NONE, nodesA, 'a', 'overlay1');
          pushOverlay(transitions.b1[cell] ?? TRANSITION_NONE, nodesB, 'b', 'overlay1');
          pushOverlay(transitions.a2[cell] ?? TRANSITION_NONE, nodesA, 'a', 'overlay2');
          pushOverlay(transitions.b2[cell] ?? TRANSITION_NONE, nodesB, 'b', 'overlay2');
        }
      }
    }
    return batcher.children();
  });
}
