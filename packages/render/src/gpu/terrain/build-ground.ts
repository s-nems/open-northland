import type { Container, TextureSource } from 'pixi.js';
import type { BrightnessField } from '../../data/brightness.js';
import type { ElevationField } from '../../data/elevation.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import {
  type NodeXY,
  nodeLaneUV,
  rectTriangleUVs,
  TRANSITION_NONE,
  transitionRef,
  triangleANodes,
  triangleBNodes,
  triangleUVs,
} from '../../data/terrain.js';
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
 * The textured terrain emitters: one batched {@link import('pixi.js').Mesh} per texture page per draw
 * layer (the GPU twin of the pure `data/terrain.ts` geometry), built once per map. A decoded map carrying
 * its 1:1 `ground` lanes (and a texture set exposing the pattern join) takes {@link buildGround}; the
 * approximated per-typeId path ({@link buildTextured}) stays for synthetic grids. The flat placeholder is
 * the twin file {@link import('./build-flat.js')}.
 */

/** One resolved transition record ready to draw: its RGBA page + the six per-pair UV tuples. */
interface ResolvedTransition {
  readonly pageKey: string;
  readonly source: TextureSource;
  readonly coordsA: readonly (readonly number[])[];
  readonly coordsB: readonly (readonly number[])[];
}

/** Append one triangle (positions + UVs + optional per-node brightness-lane UVs and wave amplitudes)
 *  to a batch. */
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
  batch.uvs.push(...uvs);
  if (lane.brightnessTex !== undefined) {
    for (const [hx, hy] of nodes) {
      batch.brightnessUVs.push(...nodeLaneUV(hx, hy, terrain.width, terrain.height, lane.laneTexWidth));
      batch.waves.push(lane.wave(hx, hy));
    }
  }
  batch.indices.push(base, base + 1, base + 2);
}

/** One batched {@link import('pixi.js').Mesh} per texture page per draw layer + a fallback
 *  {@link import('pixi.js').Graphics} for unbound triangles, per block — built once from the grid
 *  (no per-frame re-batch); the per-block split is what lets the layer's cull skip off-screen ground. */
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
    const batcher = new ChunkBatcher(lane.brightnessTex);
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
              // Unbound typeId → its flat class colour (`flatTileColour`, the table `buildFlat` uses): a
              // synthetic grid's nav classes read as grass/water/sand, and a real map's rare untextured
              // type tints by id rather than one grey (both placeholder-only; a textured cell never gets here).
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
    return { children: batcher.children(), waveUniforms: batcher.waveUniforms() };
  });
}

/**
 * The 1:1 per-triangle ground: each cell's two triangles draw the exact {@link GroundPattern} the
 * decoded map baked into its `empa`/`empb` lanes (A = △ down-left, B = ▽ to the east — see
 * `data/terrain.ts`), plus the `emt1..emt4` transition overlays as translucent RGBA triangles on
 * the two overlay layers, all batched per texture page per layer per block. The per-map pattern
 * and transition names are resolved through {@link TerrainTextureSet.groundFor} /
 * {@link TerrainTextureSet.transitionFor} once into index-aligned tables; a triangle whose
 * pattern (or page) is unresolved falls back to a flat triangle, an unresolved overlay is skipped.
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
  // Resolve the map's transition dictionary once (index-aligned; `⌊lane/6⌋` indexes it). A name
  // the IR lacks (or a page that failed to load) resolves null — that overlay is skipped.
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
    const batcher = new ChunkBatcher(lane.brightnessTex);
    // One transition overlay onto one triangle: lane value → record ⌊v/6⌋ + pair v%6 → that
    // pair's A or B UV tuple, batched on the overlay's draw layer.
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
          // Layer 1 (`emt1`/`emt2`) composites ON TOP of layer 2 (`emt3`/`emt4`) — paint order
          // lives in the batcher's layer buckets, so push order here is immaterial.
          pushOverlay(transitions.a1[cell] ?? TRANSITION_NONE, nodesA, 'a', 'overlay1');
          pushOverlay(transitions.b1[cell] ?? TRANSITION_NONE, nodesB, 'b', 'overlay1');
          pushOverlay(transitions.a2[cell] ?? TRANSITION_NONE, nodesA, 'a', 'overlay2');
          pushOverlay(transitions.b2[cell] ?? TRANSITION_NONE, nodesB, 'b', 'overlay2');
        }
      }
    }
    return { children: batcher.children(), waveUniforms: batcher.waveUniforms() };
  });
}
