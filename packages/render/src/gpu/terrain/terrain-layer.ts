import { BufferImageSource, Container, Mesh, Texture, type TextureSource } from 'pixi.js';
import { type BrightnessField, makeBrightnessField } from '../../data/brightness.js';
import { type CellCoord, diamondCornerCoords } from '../../data/cell-field.js';
import { type ElevationField, diamondCornerLifts, makeElevationField } from '../../data/elevation.js';
import { TILE_HALF_H, TILE_HALF_W, tileToScreen } from '../../data/iso.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import {
  DIAMOND_FAN_INDICES,
  DIAMOND_INDICES,
  TRIANGLE_A_CORNERS,
  TRIANGLE_A_SPLIT_INDICES,
  TRIANGLE_B_CORNERS,
  TRIANGLE_B_SPLIT_INDICES,
  diamondCorners,
  rectCenterUV,
  rectUVs,
  triangleCorners,
  triangleUVs,
  uvMidpoint,
} from '../../data/terrain.js';
import { type Viewport, aabbIntersects } from '../../data/viewport.js';
import type { GroundPattern, TerrainTextureSet } from '../pixi-app.js';
import {
  ChunkBatcher,
  type TerrainBatch,
  type TerrainChild,
  emptyBatch,
  meshGeometry,
  scaleColour,
} from './chunk-batcher.js';

/**
 * The retained terrain layer — the static ground, meshed ONCE per map and drawn per visible block.
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

/** A neutral field (no shading) — the shared default for the brightness-free path. */
const NEUTRAL_BRIGHTNESS: BrightnessField = makeBrightnessField(undefined, 0, 0);

/**
 * The brightness-lane texture UVs of a cell's four diamond corners, flat `[u0,v0, … u3,v3]` in
 * `[top, right, bottom, left]` order: the canonical corner coordinates ({@link diamondCornerCoords})
 * mapped to texel CENTRES (`(coord + 0.5) / size`), so the texture's bilinear + edge-clamp reproduces
 * `makeCellSampler` exactly at every vertex and smoothly in between.
 */
function cornerLaneUVs(col: number, row: number, width: number, height: number): number[] {
  const out: number[] = [];
  for (const [c, r] of diamondCornerCoords(col, row) as readonly CellCoord[]) {
    out.push((c + 0.5) / width, (r + 0.5) / height);
  }
  return out;
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
   * `textures` it batches every cell into one {@link Mesh} per texture page (draw-call count ~one per
   * page, independent of map size); without them it draws the flat placeholder diamonds. Either way the
   * geometry + page textures are built here and RETAINED, so no terrain work happens per frame.
   * `brightness` (the map's baked `embr` shading, neutral when absent) rides as an R8 lane texture
   * the shaded meshes sample per FRAGMENT, at canonical-cell-coordinate UVs baked per vertex — the
   * same watertight corner coordinates the `elevation` lift bakes geometry at (`cell-field.ts`).
   */
  set(
    terrain: SceneTerrain,
    textures?: TerrainTextureSet,
    elevation: ElevationField = FLAT_ELEVATION,
    brightness: BrightnessField = NEUTRAL_BRIGHTNESS,
  ): void {
    this.destroy();
    // The lane texture the shaded ground shader samples per fragment: the raw `embr` bytes as an R8
    // grid, linear-filtered + edge-clamped (the GPU twin of `makeCellSampler`'s bilinear + clamp).
    // ~W×H bytes once per map; undefined on an unshaded map (the stock-shader path). Rows are PADDED
    // to a multiple of 4 texels by replicating the last column: WebGL uploads with the default
    // UNPACK_ALIGNMENT of 4 (Pixi never lowers it), so an unpadded odd-width R8 grid would shear —
    // and the replica columns keep the right-edge clamp semantics identical to the CPU sampler.
    if (brightness.shaded && terrain.brightness !== undefined) {
      const { width, height } = terrain;
      const ROW_ALIGN = 4; // WebGL's default UNPACK_ALIGNMENT, in bytes (1 byte per R8 texel)
      const paddedW = Math.ceil(width / ROW_ALIGN) * ROW_ALIGN;
      const lane = new Uint8Array(paddedW * height);
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < paddedW; c++) {
          lane[r * paddedW + c] = terrain.brightness[r * width + Math.min(c, width - 1)] ?? 0;
        }
      }
      this.laneTexWidth = paddedW;
      this.brightnessTex = new BufferImageSource({
        resource: lane,
        width: paddedW,
        height,
        format: 'r8unorm',
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

  /**
   * Drive the chunked build: split the grid into {@link TERRAIN_CHUNK_TILES}-square blocks, hand each
   * block's inclusive tile range to `meshBlock`, wrap the display objects it returns in ONE {@link
   * Container} (kept at the world origin, so children stay in absolute world coords), record the block's
   * AABB, and add it to the terrain layer. Empty blocks are skipped. The box is computed analytically
   * from the block's corner tiles — the staggered raster `x = (2·col + parity)·halfW`, `y = row·halfH`,
   * each diamond reaching ±halfW/±halfH — so no per-cell scan is needed to know where a block lives
   * on screen.
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
          minX: 2 * c0 * TILE_HALF_W - TILE_HALF_W,
          maxX: (2 * c1 + 1) * TILE_HALF_W + TILE_HALF_W,
          // The lift only ever raises a vertex (−y), so extend the box's TOP by the map-wide-max lift so
          // culling never clips a chunk whose meshed ground was baked up a hill (the analytic AABB can't
          // see the baked lift). `maxLift` is 0 for a flat field → the box is unchanged.
          minY: r0 * TILE_HALF_H - TILE_HALF_H - maxLift,
          maxY: r1 * TILE_HALF_H + TILE_HALF_H,
        });
      }
    }
  }

  /** One batched {@link Mesh} per texture page + a fallback {@link Graphics} for unbound cells, **per
   *  block** — the GPU twin of the pure `terrain.ts` geometry, built ONCE from the grid (no per-frame
   *  re-batch); the per-block split is what lets {@link cull} skip off-screen ground. A decoded map
   *  carrying its 1:1 `ground` lanes (and a texture set exposing the pattern join) takes the
   *  per-triangle path instead; the approximated per-typeId path stays for synthetic grids. */
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
    const lifted = elevation.maxLift > 0;
    const shaded = this.brightnessTex !== undefined;
    this.buildChunks(terrain, elevation.maxLift, (c0, r0, c1, r1) => {
      const batcher = new ChunkBatcher(this.brightnessTex);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const typeId = terrain.typeIds[row * terrain.width + col] ?? -1;
          const screen = tileToScreen(col, row);
          const lifts = lifted ? diamondCornerLifts(elevation, col, row) : undefined;
          const laneUV = shaded ? cornerLaneUVs(col, row, this.laneTexWidth, terrain.height) : undefined;
          const cellTex = textures.cellFor(typeId);
          const source = cellTex !== undefined ? textures.pages.get(cellTex.pageKey) : undefined;
          if (cellTex === undefined || source === undefined) {
            batcher.drawFallback(
              screen.x,
              screen.y,
              cellTex?.fallbackColour ?? DEFAULT_TILE_COLOUR,
              lifts,
              shaded ? brightness.brightnessAt(col, row) : 1,
            );
            continue;
          }
          const batch = batcher.batchFor(cellTex.pageKey, source);
          const base = batch.positions.length / 2;
          batch.positions.push(...diamondCorners(screen.x, screen.y, lifts));
          batch.uvs.push(...rectUVs(cellTex.rect, source.width, source.height));
          if (laneUV === undefined) {
            for (const idx of DIAMOND_INDICES) batch.indices.push(base + idx);
          } else {
            // Shaded: a centre-fan so the CENTRE vertex carries the cell's OWN canonical coordinate —
            // corner UVs are between-cell coordinates and alone would flatten per-cell shading
            // (data/terrain.ts).
            batch.positions.push(screen.x, screen.y - (lifted ? elevation.liftAt(col, row) : 0));
            batch.uvs.push(...rectCenterUV(cellTex.rect, source.width, source.height));
            batch.brightnessUVs.push(
              ...laneUV,
              (col + 0.5) / this.laneTexWidth,
              (row + 0.5) / terrain.height,
            );
            for (const idx of DIAMOND_FAN_INDICES) batch.indices.push(base + idx);
          }
        }
      }
      return batcher.children();
    });
  }

  /**
   * The 1:1 per-triangle ground: each cell's two triangles draw the exact {@link GroundPattern} the
   * decoded map baked into its `empa`/`empb` lanes (triangle A = the diamond's left half, B = the
   * right — see `terrain.ts`), batched per texture page per block like the per-typeId path. The
   * per-map pattern names are resolved through {@link TerrainTextureSet.groundFor} ONCE into an
   * index-aligned table; a cell whose pattern (or page) is unresolved falls back to a flat diamond.
   */
  private buildGround(
    terrain: SceneTerrain,
    ground: NonNullable<SceneTerrain['ground']>,
    textures: TerrainTextureSet,
    elevation: ElevationField,
    brightness: BrightnessField,
  ): void {
    // Resolve the map's compact pattern list once (index-aligned); nulls fall back per cell.
    const resolved: ({ source: TextureSource; pageKey: string; pattern: GroundPattern } | null)[] =
      ground.patterns.map((name) => {
        const pattern = textures.groundFor?.(name);
        if (pattern === undefined) return null;
        const source = textures.pages.get(pattern.pageKey);
        if (source === undefined) return null;
        return { source, pageKey: pattern.pageKey, pattern };
      });
    const lifted = elevation.maxLift > 0;
    const shaded = this.brightnessTex !== undefined;
    this.buildChunks(terrain, elevation.maxLift, (c0, r0, c1, r1) => {
      const batcher = new ChunkBatcher(this.brightnessTex);
      const pushTriangle = (
        entry: { source: TextureSource; pageKey: string; pattern: GroundPattern },
        corners: readonly number[],
        coords: readonly number[],
        sx: number,
        sy: number,
        lifts: readonly number[] | undefined,
        laneUV: readonly number[] | undefined,
        centre: { readonly lift: number; readonly u: number; readonly v: number } | undefined,
      ): void => {
        const batch = batcher.batchFor(entry.pageKey, entry.source);
        const base = batch.positions.length / 2;
        batch.positions.push(...triangleCorners(sx, sy, corners, lifts));
        const uvs = triangleUVs(coords, entry.source.width, entry.source.height);
        batch.uvs.push(...uvs);
        if (laneUV === undefined || centre === undefined) {
          batch.indices.push(base, base + 1, base + 2);
          return;
        }
        // Shaded: split the triangle at the diamond CENTRE (the midpoint of its top↔bottom split
        // edge) so the centre vertex carries the cell's OWN canonical coordinate — the corner
        // coordinates are between-cell blends and alone would flatten per-cell shading (see
        // data/terrain.ts). The triangle's corner vertices ARE diamond corners, so shared vertices
        // still shade (and lift) identically across the cell's two triangles and its neighbours.
        const isA = corners === TRIANGLE_A_CORNERS;
        // Split-edge POINT indices in the pattern's point order: A = (top, bottom) at points (0, 1);
        // B = (top, bottom) at points (0, 2).
        const [mu, mv] = uvMidpoint(uvs, 0, isA ? 1 : 2);
        batch.positions.push(sx, sy - centre.lift);
        batch.uvs.push(mu, mv);
        for (const c of corners) {
          batch.brightnessUVs.push(laneUV[c * 2] ?? 0, laneUV[c * 2 + 1] ?? 0);
        }
        batch.brightnessUVs.push(centre.u, centre.v);
        for (const idx of isA ? TRIANGLE_A_SPLIT_INDICES : TRIANGLE_B_SPLIT_INDICES) {
          batch.indices.push(base + idx);
        }
      };
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const cell = row * terrain.width + col;
          const screen = tileToScreen(col, row);
          // Corner lifts are SHARED between the cell's two triangles (and its neighbours), so the
          // per-triangle ground stays a single crack-free height field. Computed once per cell; the
          // brightness corners ride the same canonical coordinates (cell-field.ts).
          const lifts = lifted ? diamondCornerLifts(elevation, col, row) : undefined;
          const laneUV = shaded ? cornerLaneUVs(col, row, this.laneTexWidth, terrain.height) : undefined;
          const centre = shaded
            ? {
                lift: lifted ? elevation.liftAt(col, row) : 0,
                u: (col + 0.5) / this.laneTexWidth,
                v: (row + 0.5) / terrain.height,
              }
            : undefined;
          const a = resolved[ground.a[cell] ?? -1] ?? null;
          const b = resolved[ground.b[cell] ?? -1] ?? null;
          if (a === null || b === null) {
            const typeId = terrain.typeIds[cell] ?? -1;
            const cellTex = textures.cellFor(typeId);
            batcher.drawFallback(
              screen.x,
              screen.y,
              cellTex?.fallbackColour ?? DEFAULT_TILE_COLOUR,
              lifts,
              shaded ? brightness.brightnessAt(col, row) : 1,
            );
            // Draw whichever half DID resolve on top of the fallback diamond.
          }
          if (a !== null) {
            pushTriangle(a, TRIANGLE_A_CORNERS, a.pattern.coordsA, screen.x, screen.y, lifts, laneUV, centre);
          }
          if (b !== null) {
            pushTriangle(b, TRIANGLE_B_CORNERS, b.pattern.coordsB, screen.x, screen.y, lifts, laneUV, centre);
          }
        }
      }
      return batcher.children();
    });
  }

  /**
   * The flat-tint placeholder ground: each block's cells batched into ONE {@link Mesh} **per distinct
   * tile colour** (a white texel tinted by the colour), built once. A grass-only block is a single
   * draw call regardless of tile count. NOT one `Graphics` of N stroked diamonds: that tessellates the
   * stroke of every cell and does not batch, so at 65 536 cells it costs ~1 s/frame on any renderer (the
   * crash-adjacent path this replaces). The per-cell grid outline is dropped (the textured ground has
   * none either); a solid ground reads the same when zoomed out. A shaded map scales each cell's tint
   * CPU-side (per-colour batches can't carry a gradient) — the flat tint is a placeholder, not the 1:1
   * look, so the cell-centre approximation is fine.
   */
  private buildFlat(terrain: SceneTerrain, elevation: ElevationField, brightness: BrightnessField): void {
    const lifted = elevation.maxLift > 0;
    const shaded = brightness.shaded;
    this.buildChunks(terrain, elevation.maxLift, (c0, r0, c1, r1) => {
      const byColour = new Map<number, TerrainBatch>();
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const typeId = terrain.typeIds[row * terrain.width + col] ?? 0;
          const screen = tileToScreen(col, row);
          const lifts = lifted ? diamondCornerLifts(elevation, col, row) : undefined;
          const baseColour = TILE_COLOURS[typeId % TILE_COLOURS.length] ?? DEFAULT_TILE_COLOUR;
          const colour = shaded ? scaleColour(baseColour, brightness.brightnessAt(col, row)) : baseColour;
          let batch = byColour.get(colour);
          if (batch === undefined) {
            batch = emptyBatch();
            byColour.set(colour, batch);
          }
          const base = batch.positions.length / 2;
          const corners = diamondCorners(screen.x, screen.y, lifts);
          batch.positions.push(...corners);
          for (let v = 0; v < corners.length / 2; v++) batch.uvs.push(0, 0); // every vertex samples the 1×1 white texel
          for (const idx of DIAMOND_INDICES) batch.indices.push(base + idx);
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
