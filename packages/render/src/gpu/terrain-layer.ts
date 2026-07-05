import { Container, Graphics, Mesh, MeshGeometry, Texture, type TextureSource } from 'pixi.js';
import { type ElevationField, diamondCornerLifts, makeElevationField } from '../data/elevation.js';
import { TILE_HALF_H, TILE_HALF_W, tileToScreen } from '../data/iso.js';
import type { SceneTerrain } from '../data/scene.js';
import {
  DIAMOND_INDICES,
  TRIANGLE_A_CORNERS,
  TRIANGLE_B_CORNERS,
  diamondCorners,
  rectUVs,
  triangleCorners,
  triangleUVs,
} from '../data/terrain.js';
import { type Viewport, aabbIntersects } from '../data/viewport.js';
import type { GroundPattern, TerrainTextureSet } from './pixi-app.js';

/**
 * The retained terrain layer — the static ground, meshed ONCE per map and drawn per visible block.
 *
 * Terrain is static geometry, but a whole-map single mesh still rasterizes off-screen ground every
 * frame (a whole-map mesh once pinned software-GL at 1fps). So the grid is meshed in
 * {@link TERRAIN_CHUNK_TILES}-square blocks each with a world-space AABB, and {@link cull} toggles each
 * block's `.visible` against the viewport per frame: **render cost tracks the SCREEN, not the map** (the
 * RTS rule — OpenRA's `Viewport` visible-cell region, our `viewport.ts`), so a 1024² map draws the same
 * handful of blocks a 64² one does. The geometry + page textures are built here and RETAINED, so no
 * terrain work happens per frame beyond the cheap visibility toggle.
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
 * ({@link import('./map-object-layer.js').MapObjectLayer}) deliberately partition world space at the
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

/** The batched geometry accumulated for one draw call (a colour, or a texture page) within a chunk. */
interface TerrainBatch {
  readonly positions: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

/** Upload one accumulated terrain batch (positions/uvs/indices) as a {@link MeshGeometry}. */
function meshGeometry(batch: TerrainBatch): MeshGeometry {
  return new MeshGeometry({
    positions: new Float32Array(batch.positions),
    uvs: new Float32Array(batch.uvs),
    indices: new Uint32Array(batch.indices),
  });
}

/** Trace one flat-colour ground diamond into a shared {@link Graphics} (the textured-terrain fallback).
 *  `lifts` (`[top, right, bottom, left]`, world px) lifts each corner by terrain height, matching the
 *  meshed cells around it; absent → flat. */
function fallbackDiamond(
  g: Graphics,
  sx: number,
  sy: number,
  colour: number,
  lifts?: readonly number[],
): void {
  g.moveTo(sx, sy - TILE_HALF_H - (lifts?.[0] ?? 0))
    .lineTo(sx + TILE_HALF_W, sy - (lifts?.[1] ?? 0))
    .lineTo(sx, sy + TILE_HALF_H - (lifts?.[2] ?? 0))
    .lineTo(sx - TILE_HALF_W, sy - (lifts?.[3] ?? 0))
    .closePath()
    .fill({ color: colour });
}

export class TerrainLayer {
  /** Static, built once by {@link set}; the renderer keeps it behind the sprite layer. */
  readonly container = new Container();
  /** The meshed terrain blocks + their world-space AABBs, culled to the viewport each frame. */
  private chunks: TerrainChunk[] = [];

  /**
   * (Re)build the cached terrain from a grid — call ONCE per map (a terrain edit re-invalidates). With
   * `textures` it batches every cell into one {@link Mesh} per texture page (draw-call count ~one per
   * page, independent of map size); without them it draws the flat placeholder diamonds. Either way the
   * geometry + page textures are built here and RETAINED, so no terrain work happens per frame.
   */
  set(terrain: SceneTerrain, textures?: TerrainTextureSet, elevation: ElevationField = FLAT_ELEVATION): void {
    this.destroy();
    if (textures !== undefined) this.buildTextured(terrain, textures, elevation);
    else this.buildFlat(terrain, elevation);
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
   * own its {@link MeshGeometry} (so `destroy` never frees the vertex/uv/index GPU buffers) — release the
   * geometry explicitly, then destroy the container + its children. The tile textures/`Texture.WHITE` are
   * SHARED sources and are deliberately left alone. Used by {@link set} (a rebuild) and the renderer's dispose.
   */
  destroy(): void {
    for (const chunk of this.chunks) {
      for (const child of chunk.container.children) {
        if (child instanceof Mesh) child.geometry.destroy();
      }
      chunk.container.destroy({ children: true });
    }
    this.chunks = [];
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
    meshBlock: (c0: number, r0: number, c1: number, r1: number) => (Mesh | Graphics)[],
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
  private buildTextured(terrain: SceneTerrain, textures: TerrainTextureSet, elevation: ElevationField): void {
    if (terrain.ground !== undefined && textures.groundFor !== undefined) {
      this.buildGround(terrain, terrain.ground, textures, elevation);
      return;
    }
    const lifted = elevation.maxLift > 0;
    this.buildChunks(terrain, elevation.maxLift, (c0, r0, c1, r1) => {
      const byPage = new Map<string, TerrainBatch & { source: TextureSource }>();
      const fallback = new Graphics();
      let fallbackUsed = false;
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const typeId = terrain.typeIds[row * terrain.width + col] ?? -1;
          const screen = tileToScreen(col, row);
          const lifts = lifted ? diamondCornerLifts(elevation, col, row) : undefined;
          const cellTex = textures.cellFor(typeId);
          const source = cellTex !== undefined ? textures.pages.get(cellTex.pageKey) : undefined;
          if (cellTex === undefined || source === undefined) {
            fallbackDiamond(
              fallback,
              screen.x,
              screen.y,
              cellTex?.fallbackColour ?? DEFAULT_TILE_COLOUR,
              lifts,
            );
            fallbackUsed = true;
            continue;
          }
          let batch = byPage.get(cellTex.pageKey);
          if (batch === undefined) {
            batch = { positions: [], uvs: [], indices: [], source };
            byPage.set(cellTex.pageKey, batch);
          }
          const base = batch.positions.length / 2;
          batch.positions.push(...diamondCorners(screen.x, screen.y, lifts));
          batch.uvs.push(...rectUVs(cellTex.rect, source.width, source.height));
          for (const idx of DIAMOND_INDICES) batch.indices.push(base + idx);
        }
      }
      const children: (Mesh | Graphics)[] = [];
      if (fallbackUsed) children.push(fallback);
      for (const batch of byPage.values()) {
        children.push(
          new Mesh({ geometry: meshGeometry(batch), texture: new Texture({ source: batch.source }) }),
        );
      }
      return children;
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
    this.buildChunks(terrain, elevation.maxLift, (c0, r0, c1, r1) => {
      const byPage = new Map<string, TerrainBatch & { source: TextureSource }>();
      const fallback = new Graphics();
      let fallbackUsed = false;
      const pushTriangle = (
        entry: { source: TextureSource; pageKey: string; pattern: GroundPattern },
        corners: readonly number[],
        coords: readonly number[],
        sx: number,
        sy: number,
        lifts: readonly number[] | undefined,
      ): void => {
        let batch = byPage.get(entry.pageKey);
        if (batch === undefined) {
          batch = { positions: [], uvs: [], indices: [], source: entry.source };
          byPage.set(entry.pageKey, batch);
        }
        const base = batch.positions.length / 2;
        batch.positions.push(...triangleCorners(sx, sy, corners, lifts));
        batch.uvs.push(...triangleUVs(coords, entry.source.width, entry.source.height));
        batch.indices.push(base, base + 1, base + 2);
      };
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const cell = row * terrain.width + col;
          const screen = tileToScreen(col, row);
          // Corner lifts are SHARED between the cell's two triangles (and its neighbours), so the
          // per-triangle ground stays a single crack-free height field. Computed once per cell.
          const lifts = lifted ? diamondCornerLifts(elevation, col, row) : undefined;
          const a = resolved[ground.a[cell] ?? -1] ?? null;
          const b = resolved[ground.b[cell] ?? -1] ?? null;
          if (a === null || b === null) {
            const typeId = terrain.typeIds[cell] ?? -1;
            const cellTex = textures.cellFor(typeId);
            fallbackDiamond(
              fallback,
              screen.x,
              screen.y,
              cellTex?.fallbackColour ?? DEFAULT_TILE_COLOUR,
              lifts,
            );
            fallbackUsed = true;
            // Draw whichever half DID resolve on top of the fallback diamond.
          }
          if (a !== null) pushTriangle(a, TRIANGLE_A_CORNERS, a.pattern.coordsA, screen.x, screen.y, lifts);
          if (b !== null) pushTriangle(b, TRIANGLE_B_CORNERS, b.pattern.coordsB, screen.x, screen.y, lifts);
        }
      }
      const children: (Mesh | Graphics)[] = [];
      if (fallbackUsed) children.push(fallback);
      for (const batch of byPage.values()) {
        children.push(
          new Mesh({ geometry: meshGeometry(batch), texture: new Texture({ source: batch.source }) }),
        );
      }
      return children;
    });
  }

  /**
   * The flat-tint placeholder ground: each block's cells batched into ONE {@link Mesh} **per distinct
   * tile colour** (a white texel tinted by the colour), built once. A grass-only block is a single
   * draw call regardless of tile count. NOT one `Graphics` of N stroked diamonds: that tessellates the
   * stroke of every cell and does not batch, so at 65 536 cells it costs ~1 s/frame on any renderer (the
   * crash-adjacent path this replaces). The per-cell grid outline is dropped (the textured ground has
   * none either); a solid ground reads the same when zoomed out.
   */
  private buildFlat(terrain: SceneTerrain, elevation: ElevationField): void {
    const lifted = elevation.maxLift > 0;
    this.buildChunks(terrain, elevation.maxLift, (c0, r0, c1, r1) => {
      const byColour = new Map<number, TerrainBatch>();
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const typeId = terrain.typeIds[row * terrain.width + col] ?? 0;
          const screen = tileToScreen(col, row);
          const lifts = lifted ? diamondCornerLifts(elevation, col, row) : undefined;
          const colour = TILE_COLOURS[typeId % TILE_COLOURS.length] ?? DEFAULT_TILE_COLOUR;
          let batch = byColour.get(colour);
          if (batch === undefined) {
            batch = { positions: [], uvs: [], indices: [] };
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
