import { BufferImageSource, Container, Mesh, Texture, type TextureSource } from 'pixi.js';
import { type BrightnessField, makeBrightnessField, scaleColour } from '../../data/brightness.js';
import { type ElevationField, makeElevationField } from '../../data/elevation.js';
import { TILE_HALF_H, TILE_HALF_W, halfCellToScreen } from '../../data/iso.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import {
  type NodeXY,
  TRANSITION_NONE,
  nodeLaneUV,
  nodeLift,
  rectTriangleUVs,
  transitionRef,
  triangleANodes,
  triangleBNodes,
  triangleUVs,
} from '../../data/terrain.js';
import { type Viewport, aabbIntersects } from '../../data/viewport.js';
import type { GroundPattern, TerrainTextureSet } from '../pixi-app.js';
import { padLaneRows } from '../shading.js';
import {
  ChunkBatcher,
  type TerrainBatch,
  type TerrainChild,
  type TerrainLayerKind,
  emptyBatch,
  meshGeometry,
} from './chunk-batcher.js';

/**
 * The retained terrain layer — the static ground, meshed ONCE per map and drawn per visible block.
 *
 * THE MESH is the original's tessellation (`data/terrain.ts`): vertices are cell-centre NODES and
 * each cell contributes two triangles spanning BETWEEN neighbouring centres (△ A down to the
 * SW/SE-below cells, ▽ B across to the E cell) — so per-triangle pattern picks and transition
 * overlays blend organically across cells instead of along per-cell diamond seams. Per-node
 * elevation lift (`elevation/16` half-row-steps, border clamped to 0) warps the whole ground
 * continuously; the map's `emt1..emt4` transition lanes draw as translucent RGBA overlay meshes
 * composited base → layer 2 → layer 1 by child order.
 *
 * Terrain is static geometry, but a whole-map single mesh still rasterizes off-screen ground every
 * frame (a whole-map mesh once pinned software-GL at 1fps). So the grid is meshed in
 * {@link TERRAIN_CHUNK_TILES}-square blocks each with a world-space AABB, and {@link TerrainLayer.cull}
 * toggles each block's `.visible` against the viewport per frame: **render cost tracks the SCREEN, not
 * the map** (the RTS rule — OpenRA's `Viewport` visible-cell region, our `viewport.ts`), so a 1024² map
 * draws the same handful of blocks a 64² one does. The geometry + page textures are built here and
 * RETAINED, so no terrain work happens per frame beyond the cheap visibility toggle.
 */

/** A flat colour per landscape typeId for the placeholder terrain (cycled if a typeId exceeds the table). */
const TILE_COLOURS: readonly number[] = [
  0x4a7c3a, // 0: grass
  0x3a6ea5, // 1: water
  0x8a6d3b, // 2: dirt/path
  0x9a9a9a, // 3: stone
];
const DEFAULT_TILE_COLOUR = 0x4a7c3a;

/**
 * The placeholder flat tint for a landscape typeId (`0xRRGGBB`) — the same table the flat-tint ground
 * path batches by, exported so other typeId→colour consumers (the app's minimap raster) fall back to
 * the exact colours the placeholder ground draws instead of re-inventing a palette.
 */
export function flatTileColour(typeId: number): number {
  return TILE_COLOURS[typeId % TILE_COLOURS.length] ?? DEFAULT_TILE_COLOUR;
}

/**
 * Terrain is meshed in square blocks of this many tiles a side, and each frame only the blocks whose
 * world-space box meets the viewport are drawn. 32 keeps the visible-block count (≈ draw calls) low
 * while still culling tightly at the screen edges. Exported because the decor/tall map-object blocks
 * ({@link import('../map-objects/index.js').MapObjectLayer}) deliberately partition world space at the
 * SAME scale, so the two layers cull in lockstep.
 */
export const TERRAIN_CHUNK_TILES = 32;

/**
 * One meshed terrain block: its display {@link Container} (built once) plus the world-space AABB used to
 * toggle `.visible` against the viewport each frame. Children hold ABSOLUTE world coords (the container
 * sits at the origin), so the box math and the sprite cull share one coordinate space.
 */
interface TerrainChunk {
  readonly container: Container;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** A flat field (no lift) — the shared default for the elevation-free path (synthetic grids / no lane). */
const FLAT_ELEVATION: ElevationField = makeElevationField(undefined, 0, 0);

/**
 * Quantization steps for the flat placeholder's CPU-side shading: its meshes batch by EXACT colour,
 * so the multiplier snaps to this many levels per unit to keep the per-block mesh count bounded (a
 * placeholder path — coarse banding is acceptable, hundreds of one-cell meshes are not).
 */
const FLAT_SHADE_STEPS = 8;

/** A node's upward lift in world px — 0 on a flat map, per-node elevation otherwise. */
type NodeLiftFn = (hx: number, hy: number) => number;

/** No lift — the flat map's shared {@link NodeLiftFn}. */
const NO_LIFT: NodeLiftFn = () => 0;

/** One resolved transition record ready to draw: its RGBA page + the six per-pair UV tuples. */
interface ResolvedTransition {
  readonly pageKey: string;
  readonly source: TextureSource;
  readonly coordsA: readonly (readonly number[])[];
  readonly coordsB: readonly (readonly number[])[];
}

export class TerrainLayer {
  /** Static, built once by {@link set}; the renderer keeps it behind the sprite layer. */
  readonly container = new Container();
  /** The meshed terrain blocks + their world-space AABBs, culled to the viewport each frame. */
  private chunks: TerrainChunk[] = [];
  /** The map's `embr` lane as an R8 texture (per-fragment shading); undefined on an unshaded map. */
  private brightnessTex: BufferImageSource | undefined;
  /** The lane texture's padded width in texels (the `u` denominator; see {@link set}'s padding note). */
  private laneTexWidth = 0;

  /**
   * (Re)build the cached terrain from a grid — call ONCE per map (a terrain edit re-invalidates). With
   * `textures` it batches every cell's two triangles into one {@link Mesh} per texture page per draw
   * layer (draw-call count ~one per page per layer, independent of map size); without them it draws
   * the flat placeholder triangles. Either way the geometry + page textures are built here and
   * RETAINED, so no terrain work happens per frame. The map's baked `embr` shading
   * (`terrain.brightness`, absent → unshaded) rides as an R8 lane texture the shaded meshes sample
   * per FRAGMENT, at each vertex's own cell-centre coordinate — the engine model (one value per
   * node, blended across the triangle).
   */
  set(terrain: SceneTerrain, textures?: TerrainTextureSet, elevation: ElevationField = FLAT_ELEVATION): void {
    this.destroy();
    // ONE source for the shading: both the CPU field (fallback/flat tints) and the R8 lane texture
    // are built HERE from `terrain.brightness`, so no caller can hand the mesh and the fallbacks
    // disagreeing inputs (the elevation field stays injected — the renderer retains it per frame).
    const brightness = makeBrightnessField(terrain.brightness, terrain.width, terrain.height);
    // The lane texture the shaded ground shader samples per fragment: the raw `embr` bytes as an R8
    // grid, linear-filtered + edge-clamped (the GPU twin of `makeCellSampler`'s bilinear + clamp).
    // ~W×H bytes once per map; undefined on an unshaded map (the stock-shader path) and on the flat
    // placeholder path (which shades CPU-side). Rows are alignment-padded — see `padLaneRows`.
    if (brightness.shaded && terrain.brightness !== undefined && textures !== undefined) {
      const ROW_ALIGN = 4; // WebGL's default UNPACK_ALIGNMENT, in bytes (1 byte per R8 texel)
      const lane = padLaneRows(terrain.brightness, terrain.width, terrain.height, ROW_ALIGN);
      this.laneTexWidth = lane.paddedWidth;
      this.brightnessTex = new BufferImageSource({
        resource: lane.data,
        width: lane.paddedWidth,
        height: terrain.height,
        format: 'r8unorm',
        // The GPU twin of `makeCellSampler` (bilinear + edge clamp) is a CONTRACT, not an inherited
        // default — pin it (this codebase flips other sources to 'nearest' for pixel art).
        scaleMode: 'linear',
        addressMode: 'clamp-to-edge',
      });
    }
    if (textures !== undefined) this.buildTextured(terrain, textures, elevation, brightness);
    else this.buildFlat(terrain, elevation, brightness);
  }

  /**
   * Draw ONLY the blocks whose box meets the viewport (RTS rule — cost tracks the screen, not the map).
   * Off-screen blocks stay in the graph but skip rasterization; a bounded MIN_ZOOM keeps the
   * visible-block count small even fully zoomed out.
   */
  cull(vp: Viewport): void {
    for (const chunk of this.chunks) {
      chunk.container.visible = aabbIntersects(vp, chunk);
    }
  }

  /**
   * Free the current terrain: each chunk is a {@link Container} of {@link Mesh}es, and a `Mesh` does NOT
   * own its {@link import('pixi.js').MeshGeometry} or its custom shader (so `destroy` never frees the
   * vertex/uv/index GPU buffers or the shader's uniform state) — release both explicitly, then destroy
   * the container + its children. The tile textures/`Texture.WHITE` are SHARED sources and are
   * deliberately left alone (as is the shaded ground's process-wide GL program). Used by {@link set}
   * (a rebuild) and the renderer's dispose.
   */
  destroy(): void {
    for (const chunk of this.chunks) {
      for (const child of chunk.container.children) {
        if (child instanceof Mesh) {
          child.geometry.destroy();
          child.shader?.destroy();
        }
      }
      chunk.container.destroy({ children: true });
    }
    this.chunks = [];
    this.brightnessTex?.destroy();
    this.brightnessTex = undefined;
    this.laneTexWidth = 0;
  }

  /** The per-node lift for this map: 0 everywhere on a flat field, else the node's own cell's lift
   *  with the map-border ring clamped to 0 (`data/terrain.ts` `nodeLift`). */
  private static liftFn(terrain: SceneTerrain, elevation: ElevationField): NodeLiftFn {
    if (elevation.maxLift <= 0) return NO_LIFT;
    return (hx, hy) => nodeLift(elevation.liftAt, hx, hy, terrain.width, terrain.height);
  }

  /** One triangle's 3 lifted vertex positions (flat `[x0,y0, …]`, world px) from its lattice nodes. */
  private static positions(nodes: readonly [NodeXY, NodeXY, NodeXY], lift: NodeLiftFn): number[] {
    const out: number[] = [];
    for (const [hx, hy] of nodes) {
      const p = halfCellToScreen(hx, hy);
      out.push(p.x, p.y - lift(hx, hy));
    }
    return out;
  }

  /**
   * Drive the chunked build: split the grid into {@link TERRAIN_CHUNK_TILES}-square blocks, hand each
   * block's inclusive tile range to `meshBlock`, wrap the display objects it returns in ONE {@link
   * Container} (kept at the world origin, so children stay in absolute world coords), record the block's
   * AABB, and add it to the terrain layer. Empty blocks are skipped. The box is computed analytically
   * from the block's corner cells' triangle extents — a cell's triangles span nodes from `hx−1` to
   * `hx+2` and rows `hy..hy+2` (`x ∈ [(2c−1)·halfW, (2c+3)·halfW]`, `y ∈ [r·rowStep, (r+1)·rowStep]`)
   * — so no per-cell scan is needed to know where a block lives on screen.
   */
  private buildChunks(
    terrain: SceneTerrain,
    maxLift: number,
    meshBlock: (c0: number, r0: number, c1: number, r1: number) => TerrainChild[],
  ): void {
    for (let r0 = 0; r0 < terrain.height; r0 += TERRAIN_CHUNK_TILES) {
      for (let c0 = 0; c0 < terrain.width; c0 += TERRAIN_CHUNK_TILES) {
        const c1 = Math.min(c0 + TERRAIN_CHUNK_TILES, terrain.width) - 1;
        const r1 = Math.min(r0 + TERRAIN_CHUNK_TILES, terrain.height) - 1;
        const children = meshBlock(c0, r0, c1, r1);
        if (children.length === 0) continue;
        const container = new Container();
        for (const child of children) container.addChild(child);
        this.container.addChild(container);
        this.chunks.push({
          container,
          minX: (2 * c0 - 1) * TILE_HALF_W,
          maxX: (2 * c1 + 3) * TILE_HALF_W,
          // The lift only ever raises a vertex (−y), so extend the box's TOP by the map-wide-max lift so
          // culling never clips a chunk whose meshed ground was baked up a hill (the analytic AABB can't
          // see the baked lift). `maxLift` is 0 for a flat field → the box is unchanged.
          minY: r0 * TILE_HALF_H - maxLift,
          maxY: (r1 + 1) * TILE_HALF_H,
        });
      }
    }
  }

  /** One batched {@link Mesh} per texture page per draw layer + a fallback {@link Graphics} for
   *  unbound triangles, **per block** — the GPU twin of the pure `terrain.ts` geometry, built ONCE
   *  from the grid (no per-frame re-batch); the per-block split is what lets {@link cull} skip
   *  off-screen ground. A decoded map carrying its 1:1 `ground` lanes (and a texture set exposing
   *  the pattern join) takes the per-triangle path; the approximated per-typeId path stays for
   *  synthetic grids. */
  private buildTextured(
    terrain: SceneTerrain,
    textures: TerrainTextureSet,
    elevation: ElevationField,
    brightness: BrightnessField,
  ): void {
    if (terrain.ground !== undefined && textures.groundFor !== undefined) {
      this.buildGround(terrain, terrain.ground, textures, elevation, brightness);
      return;
    }
    const lift = TerrainLayer.liftFn(terrain, elevation);
    const shaded = this.brightnessTex !== undefined;
    this.buildChunks(terrain, elevation.maxLift, (c0, r0, c1, r1) => {
      const batcher = new ChunkBatcher(this.brightnessTex);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const typeId = terrain.typeIds[row * terrain.width + col] ?? -1;
          const cellTex = textures.cellFor(typeId);
          const source = cellTex !== undefined ? textures.pages.get(cellTex.pageKey) : undefined;
          const triangles = [triangleANodes(col, row), triangleBNodes(col, row)] as const;
          if (cellTex === undefined || source === undefined) {
            for (const nodes of triangles) {
              batcher.drawFallbackTriangle(
                TerrainLayer.positions(nodes, lift),
                cellTex?.fallbackColour ?? DEFAULT_TILE_COLOUR,
                shaded ? brightness.brightnessAt(col, row) : 1,
              );
            }
            continue;
          }
          const batch = batcher.batchFor(cellTex.pageKey, source);
          for (const [t, nodes] of triangles.entries()) {
            this.pushTriangle(
              batch,
              nodes,
              rectTriangleUVs(cellTex.rect, t === 0 ? 'a' : 'b', source.width, source.height),
              lift,
              shaded,
              terrain,
            );
          }
        }
      }
      return batcher.children();
    });
  }

  /** Append one triangle (positions + UVs + optional per-node brightness-lane UVs) to a batch. */
  private pushTriangle(
    batch: TerrainBatch,
    nodes: readonly [NodeXY, NodeXY, NodeXY],
    uvs: readonly number[],
    lift: NodeLiftFn,
    shaded: boolean,
    terrain: SceneTerrain,
  ): void {
    const base = batch.positions.length / 2;
    batch.positions.push(...TerrainLayer.positions(nodes, lift));
    batch.uvs.push(...uvs);
    if (shaded) {
      for (const [hx, hy] of nodes) {
        batch.brightnessUVs.push(...nodeLaneUV(hx, hy, terrain.width, terrain.height, this.laneTexWidth));
      }
    }
    batch.indices.push(base, base + 1, base + 2);
  }

  /**
   * The 1:1 per-triangle ground: each cell's two triangles draw the exact {@link GroundPattern} the
   * decoded map baked into its `empa`/`empb` lanes (A = △ down-left, B = ▽ to the east — see
   * `data/terrain.ts`), plus the `emt1..emt4` transition overlays as translucent RGBA triangles on
   * the two overlay layers, all batched per texture page per layer per block. The per-map pattern
   * and transition names are resolved through {@link TerrainTextureSet.groundFor} /
   * {@link TerrainTextureSet.transitionFor} ONCE into index-aligned tables; a triangle whose
   * pattern (or page) is unresolved falls back to a flat triangle, an unresolved overlay is skipped.
   */
  private buildGround(
    terrain: SceneTerrain,
    ground: NonNullable<SceneTerrain['ground']>,
    textures: TerrainTextureSet,
    elevation: ElevationField,
    brightness: BrightnessField,
  ): void {
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
    const lift = TerrainLayer.liftFn(terrain, elevation);
    const shaded = this.brightnessTex !== undefined;
    this.buildChunks(terrain, elevation.maxLift, (c0, r0, c1, r1) => {
      const batcher = new ChunkBatcher(this.brightnessTex);
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
        this.pushTriangle(
          batcher.batchFor(t.pageKey, t.source, layer),
          nodes,
          triangleUVs(coords, t.source.width, t.source.height),
          lift,
          shaded,
          terrain,
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
                TerrainLayer.positions(nodes, lift),
                textures.cellFor(typeId)?.fallbackColour ?? DEFAULT_TILE_COLOUR,
                shaded ? brightness.brightnessAt(col, row) : 1,
              );
              continue;
            }
            this.pushTriangle(
              batcher.batchFor(entry.pageKey, entry.source),
              nodes,
              triangleUVs(
                which === 'a' ? entry.pattern.coordsA : entry.pattern.coordsB,
                entry.source.width,
                entry.source.height,
              ),
              lift,
              shaded,
              terrain,
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
      return batcher.children();
    });
  }

  /**
   * The flat-tint placeholder ground: each block's cell triangles batched into ONE {@link Mesh}
   * **per distinct tile colour** (a white texel tinted by the colour), built once. A grass-only
   * block is a single draw call regardless of tile count. NOT one `Graphics` of N stroked cells:
   * that tessellates the stroke of every cell and does not batch, so at 65 536 cells it costs
   * ~1 s/frame on any renderer (the crash-adjacent path this replaces). A shaded map scales each
   * cell's tint CPU-side, QUANTIZED to {@link FLAT_SHADE_STEPS} steps — the batches are keyed by
   * exact colour, so an unquantized smooth gradient would explode the per-block mesh count. The
   * flat tint is a placeholder, not the 1:1 look, so the coarse cell-centre shading is fine.
   */
  private buildFlat(terrain: SceneTerrain, elevation: ElevationField, brightness: BrightnessField): void {
    const lift = TerrainLayer.liftFn(terrain, elevation);
    const shaded = brightness.shaded;
    this.buildChunks(terrain, elevation.maxLift, (c0, r0, c1, r1) => {
      const byColour = new Map<number, TerrainBatch>();
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const typeId = terrain.typeIds[row * terrain.width + col] ?? 0;
          const baseColour = flatTileColour(typeId);
          const colour = shaded
            ? scaleColour(
                baseColour,
                Math.round(brightness.brightnessAt(col, row) * FLAT_SHADE_STEPS) / FLAT_SHADE_STEPS,
              )
            : baseColour;
          let batch = byColour.get(colour);
          if (batch === undefined) {
            batch = emptyBatch();
            byColour.set(colour, batch);
          }
          for (const nodes of [triangleANodes(col, row), triangleBNodes(col, row)]) {
            const base = batch.positions.length / 2;
            batch.positions.push(...TerrainLayer.positions(nodes, lift));
            for (let v = 0; v < 3; v++) batch.uvs.push(0, 0); // every vertex samples the 1×1 white texel
            batch.indices.push(base, base + 1, base + 2);
          }
        }
      }
      const children: Mesh[] = [];
      for (const [colour, batch] of byColour) {
        const mesh = new Mesh({ geometry: meshGeometry(batch), texture: Texture.WHITE });
        mesh.tint = colour;
        children.push(mesh);
      }
      return children;
    });
  }
}
