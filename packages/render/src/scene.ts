import type { WorldSnapshot } from '@vinland/sim';
import { ONE, tileToScreen } from './index.js';

/**
 * The PURE scene-building layer — the part of rendering an agent CAN self-verify.
 *
 * It turns a {@link WorldSnapshot} (+ the terrain grid dimensions) into a flat, **depth-sorted**
 * list of draw items in isometric screen space. No Pixi, no canvas, no GPU: this is plain data the
 * GPU layer (the un-self-verifiable pixel half, deferred to a human) walks in order. Keeping the
 * projection + depth-sort here means the load-bearing render logic — *which* item draws *where* and
 * *in what order* — is unit-testable without a screen (see test/scene.test.ts).
 *
 * Why floats are fine here: this is `render`, a pure consumer of sim state (docs/ARCHITECTURE.md).
 * The sim stays fixed-point; render reads the snapshot's `Fixed` position (a scaled integer) and
 * divides by ONE to a float tile coordinate. Nothing here feeds back into the sim.
 */

/**
 * Depth-packing constants. A sprite's sort key is `tileY * ROW_STRIDE + tileX`, so the integer-tile
 * `y` dominates and `x` orders within a row — valid only while `tileX < ROW_STRIDE`, which holds for
 * any sane map (sim positions stay well under ~2^25 tiles; real maps are a few hundred). Tiles sit in
 * a band shifted strictly below every sprite (`TILE_DEPTH_BASE`), so ground never paints over a
 * sprite even at the largest map.
 */
const ROW_STRIDE = 4096;
const TILE_DEPTH_BASE = -1_000_000;

/**
 * The atomic id of the woodcut swing (the demo slice's `harvest`, the `tribetypes` `setatomic` join key;
 * the same id `real-sprites.ts` binds the chop animation to). A settler harvesting a tree stands ON the
 * resource cell (the planner positions it there, `ai.ts`), so at the cell centre its sprite overlaps the
 * tree and the axe — which swings out to the figure's RIGHT — comes down through empty air beside the
 * trunk. {@link CHOP_NUDGE_X} offsets a chopping settler's sprite so the strike lands IN the tree.
 */
const CHOP_ATOMIC_ID = 24;
/**
 * Screen-x shift (pixels, negative = left) applied to a settler's sprite while it is mid-chop, so it
 * stands slightly LEFT of the tree it shares a cell with and its right-hand axe swing connects with the
 * trunk at the cell centre. A render-only visual nudge: the sim position (and the depth sort) is
 * unchanged — only the drawn anchor moves — so determinism and occlusion are untouched. Tunable by eye.
 */
const CHOP_NUDGE_X = -24;

/** Kinds of thing the scene draws, in their natural layer grouping. */
export type DrawKind = 'tile' | 'building' | 'settler' | 'resource';

/**
 * A sprite's coarse logical state, the join key onto a per-state animation binding (the original's
 * `tribetypes` `setatomic` maps an atomic → its animation; a settler walking shows the walk bob, one
 * mid-swing the chop bob). Derived purely from the snapshot's components — `CurrentAtomic` ⇒ `acting`
 * (and the atomic's numeric id rides along as {@link DrawItem.atomicId} so a binding can pick the
 * *specific* action's frame), else a live `PathFollow` ⇒ `moving`, else `idle`. Buildings/resources
 * are always `idle` (they don't animate per-state in this slice). This is the render-side reading of
 * sim state the roadmap calls "animation playback driven by each entity's logical state"; it never
 * re-enters the sim.
 */
export type SpriteState = 'idle' | 'moving' | 'acting';

/**
 * One item to draw, already projected to isometric screen space (before the camera transform). The
 * GPU layer draws these in array order; `depth` is the sort key it was ordered by (kept for debug /
 * stable-sort proofs). Floats are deliberate (render-only).
 */
export interface DrawItem {
  readonly kind: DrawKind;
  /** Source entity id, or the cell id for a terrain tile (so a click can map a pixel back). */
  readonly ref: number;
  /** Isometric screen position of the item's anchor (tile centre for tiles; feet for sprites). */
  readonly x: number;
  readonly y: number;
  /** The world-space sort key the item was ordered by (see {@link buildScene}). */
  readonly depth: number;
  /** For a terrain tile: its landscape typeId, so the GPU layer can pick the tile sprite. */
  readonly typeId?: number;
  /** For a sprite: its coarse logical state, so a per-state binding can pick the right frame. */
  readonly state?: SpriteState;
  /** For an `acting` sprite: the numeric atomic id it's executing (the `setatomic` join key). */
  readonly atomicId?: number;
  /**
   * For an `acting` sprite: whole ticks executed in its current atomic so far — the sim's
   * `CurrentAtomic.elapsed`. The animation clock for an action: a directional binding advances its
   * swing one frame every `ticksPerFrame` of these ticks, a FIXED cadence — so every action animates at
   * the same speed (a 15-tick chop and a 4-tick deposit step frames identically), and a swing plays its
   * full cycle because the action's duration is tuned to a whole number of cycles. Omitted when idle.
   */
  readonly elapsed?: number;
  /**
   * For a settler: its facing direction index (0..7) — the screen-space heading a directional
   * animation binding indexes by. The `CR_Hum_Body` bob layout is NOT a uniform rotation; its 8 blocks
   * face (read off the decoded frames, `docs/FIDELITY.md` "Settler facing"): `0 SW, 1 W, 2 NW, 3 NE,
   * 4 E, 5 SE, 6 S, 7 N`. Derived from the live {@link readFacing} heading; omitted when the settler
   * isn't moving (the binding then falls back to {@link DEFAULT_FACING}).
   */
  readonly facing?: number;
  /**
   * For a settler: whether it is currently hauling a good (the sim `Carrying` component is present).
   * ORTHOGONAL to {@link state} — a settler can be carrying while `moving` (walking a load home) or
   * `acting` (depositing it). A binding reads it to swap the empty-handed gait for the loaded one (the
   * original's `..._walk_wood` bobseq instead of `..._walk`). Omitted when the settler carries nothing.
   */
  readonly carrying?: boolean;
}

/** The terrain grid the snapshot is positioned over (dimensions + row-major landscape typeIds). */
export interface SceneTerrain {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell, length `width*height`. */
  readonly typeIds: readonly number[];
}

/**
 * Project a loaded terrain map (the `{ width, height, typeIds }` shape `parseTerrainMap` validates a
 * `content/maps/<id>.json` into, structurally a sim `TerrainMap`) onto the {@link SceneTerrain} the
 * scene layer draws. This is the typed seam from a **real decoded map** to the renderer: the app/shot
 * entry loads a map file, validates it through `@vinland/data`, and feeds the result here — so the
 * same render line that draws the synthetic grass strip draws an actual decoded grid.
 *
 * Pure + total: it only re-views the (read-only) grid as the render shape, asserting nothing the
 * loader already enforced (the data-package zod schema pins `typeIds.length === width*height`). The
 * map's landscape typeIds carry straight through — the GPU layer tints each tile by typeId — so a
 * real multi-terrain map renders its varied ground, not a uniform fill.
 */
export function terrainMapToScene(map: {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
}): SceneTerrain {
  return { width: map.width, height: map.height, typeIds: map.typeIds };
}

/**
 * The snapshot's `Position` component value, as plain data (Fixed = a scaled integer). Mirrors the
 * sim component; redeclared here so `render` doesn't reach into sim internals for a 2-field shape.
 */
interface PositionValue {
  x: number;
  y: number;
}

function readPosition(components: Readonly<Record<string, unknown>>): PositionValue | null {
  const p = components.Position as PositionValue | undefined;
  if (p === undefined || typeof p.x !== 'number' || typeof p.y !== 'number') return null;
  return p;
}

/** Classify a snapshot entity by which marker component it carries (terrain tiles are separate). */
function classify(components: Readonly<Record<string, unknown>>): DrawKind | null {
  if ('Building' in components) return 'building';
  if ('Resource' in components) return 'resource';
  if ('Settler' in components) return 'settler';
  return null; // an entity with a Position but no drawable marker is skipped (e.g. a pure mover)
}

/**
 * The atomic id a snapshot entity is mid-execution on, or `null`. Reads only the `atomicId` field of
 * the (plain-cloned) `CurrentAtomic` component — the same numeric id the sim stores as the `setatomic`
 * animation join key. Total: a missing/malformed component reads as "not acting".
 */
function readActingAtomic(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { atomicId?: unknown } | undefined;
  if (a === undefined || typeof a.atomicId !== 'number') return null;
  return a.atomicId;
}

/**
 * The whole ticks the settler has executed in its current atomic — the sim's `CurrentAtomic.elapsed`
 * (a plain integer, no fixed-point rescale). The action's animation clock: a directional swing advances
 * at a fixed cadence over these ticks, so its speed never depends on the action's duration. Returns
 * `null` when not mid-atomic. Pure read of plain snapshot data (no sim re-entry).
 */
function readAtomicElapsed(components: Readonly<Record<string, unknown>>): number | null {
  const a = components.CurrentAtomic as { elapsed?: unknown } | undefined;
  if (a === undefined || typeof a.elapsed !== 'number') return null;
  return a.elapsed;
}

/**
 * The bob's facing-direction index for a unit step toward the next waypoint, keyed by the SIGN of the
 * grid delta `(sign dCol, sign dRow)`. The `CR_Hum_Body` sheet's 8 direction blocks are NOT a uniform
 * screen-angle rotation — each was read off the decoded frames one by one (`docs/FIDELITY.md` "Settler
 * facing"; blocks face `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`) — so a screen-angle formula can't
 * pick them; we map each grid step straight to the block whose sprite faces that step's ISO-screen
 * heading. A grid step projects to screen as `(dCol−dRow, dCol+dRow)`:
 *   E (1,0)→screen SE→block 5,  S (0,1)→SW→0,  W (−1,0)→NW→2,  N (0,−1)→NE→3,
 *   SE(1,1)→screen S →block 6,  SW(−1,1)→W →1,  NW(−1,−1)→N→7,  NE(1,−1)→E→4.
 * The four AXIS steps (the only ones a 4-connected path emits) are the screen-diagonal facings 5/0/2/3.
 */
const STEP_TO_FACING: Readonly<Record<string, number>> = {
  '1,0': 5, // E  -> screen SE
  '0,1': 0, // S  -> screen SW
  '-1,0': 2, // W  -> screen NW
  '0,-1': 3, // N  -> screen NE
  '1,1': 6, // SE -> screen S
  '-1,1': 1, // SW -> screen W
  '-1,-1': 7, // NW -> screen N
  '1,-1': 4, // NE -> screen E
};

/**
 * One {@link PathFollow} waypoint, as plain snapshot data (Fixed = scaled int). Redeclared here so
 * `render` doesn't import the sim component shape for a 2-field read.
 */
interface WaypointValue {
  x: number;
  y: number;
}

/**
 * Derive a settler's facing direction index (0..7) from its live heading: the grid step from its current
 * position toward the {@link PathFollow} waypoint it is walking to, looked up in {@link STEP_TO_FACING}
 * (the block whose sprite faces that step's ISO-screen heading). Only the SIGN of each delta matters —
 * the heading is always a grid direction (cell-to-cell), so a sign pair keys the table exactly, with no
 * angle/rounding. Returns `undefined` when there is no movement to read a heading from (no path, or
 * already on the waypoint) — the binding then falls back to a default facing. Pure read of plain data.
 */
function readFacing(components: Readonly<Record<string, unknown>>): number | undefined {
  const pf = components.PathFollow as { waypoints?: unknown; index?: unknown } | undefined;
  const pos = readPosition(components);
  if (pf === undefined || pos === null || !Array.isArray(pf.waypoints)) return undefined;
  const idx = typeof pf.index === 'number' ? pf.index : 0;
  const wp = pf.waypoints[idx] as WaypointValue | undefined;
  if (wp === undefined || typeof wp.x !== 'number' || typeof wp.y !== 'number') return undefined;
  const dCol = wp.x - pos.x;
  const dRow = wp.y - pos.y;
  if (dCol === 0 && dRow === 0) return undefined; // already there — no heading
  return STEP_TO_FACING[`${Math.sign(dCol)},${Math.sign(dRow)}`];
}

/**
 * Derive a sprite's coarse {@link SpriteState} from its snapshot components, in priority order:
 * mid-atomic (`CurrentAtomic`) ⇒ `acting`, else following a path (`PathFollow`) ⇒ `moving`, else
 * `idle`. Acting wins over moving because a settler that started an atomic has stopped to act even if
 * a stale path lingers. Pure read of plain snapshot data — never re-enters the sim.
 */
function readSpriteState(components: Readonly<Record<string, unknown>>): SpriteState {
  if (readActingAtomic(components) !== null) return 'acting';
  if ('PathFollow' in components) return 'moving';
  return 'idle';
}

/**
 * Whether a snapshot settler is hauling a good — the mere presence of its (plain-cloned) `Carrying`
 * component (the sim adds it on harvest, removes it on deposit). Read as a flag orthogonal to
 * {@link readSpriteState} so a binding can pick the loaded gait while the settler still reads as
 * `moving`/`acting`. Pure read of plain snapshot data — never re-enters the sim.
 */
function readCarrying(components: Readonly<Record<string, unknown>>): boolean {
  return 'Carrying' in components;
}

/**
 * Build the depth-sorted isometric draw list for a frame.
 *
 * Ordering — the core correctness property a human eyeball would otherwise have to catch:
 *  1. **Terrain first, always behind sprites.** Tiles are emitted in row-major (back-to-front) order
 *     and carry a depth below every sprite, so no sprite is ever hidden by ground drawn after it.
 *  2. **Sprites sorted by feet anchor** = ascending world `(y, x)` (a settler lower/further-right on
 *     the map occludes one behind it). The sort key is the float tile `y` (the feet), with `x` then
 *     entity `id` as deterministic tie-breaks so the order is total and stable.
 *
 * Pure: a function of the snapshot + grid only. The same snapshot always yields the same list — the
 * determinism that lets the screenshot harness produce a reproducible frame.
 */
export function buildScene(snapshot: WorldSnapshot, terrain: SceneTerrain): DrawItem[] {
  const tiles: DrawItem[] = [];
  // Terrain: one tile per cell, row-major (y outer, x inner) = back-to-front in iso space. Its depth
  // is forced below any sprite (negative world-space band) so ground never paints over a sprite.
  for (let cell = 0; cell < terrain.typeIds.length; cell++) {
    const typeId = terrain.typeIds[cell];
    if (typeId === undefined) continue; // unreachable (cell < length) — satisfies noUncheckedIndexedAccess
    const col = cell % terrain.width;
    const row = Math.floor(cell / terrain.width);
    const screen = tileToScreen(col, row);
    tiles.push({
      kind: 'tile',
      ref: cell,
      x: screen.x,
      y: screen.y,
      // Tiles sort among themselves back-to-front (col+row), shifted into a band strictly below
      // every sprite depth (sprite depths are >= 0 world rows; tiles are negative).
      depth: TILE_DEPTH_BASE + (col + row),
      typeId,
    });
  }

  const sprites: DrawItem[] = [];
  for (const entity of snapshot.entities) {
    const kind = classify(entity.components);
    if (kind === null) continue;
    const pos = readPosition(entity.components);
    if (pos === null) continue;
    // Fixed (scaled int) -> float tile coordinate. Render-only; never re-enters the sim.
    const tileX = pos.x / ONE;
    const tileY = pos.y / ONE;
    const screen = tileToScreen(tileX, tileY);
    // Only settlers animate per-state in this slice; a building/resource is always idle. When acting,
    // carry the atomic id so a per-state binding can pick the specific action's frame (the `setatomic`
    // join key); otherwise it's omitted under exactOptionalPropertyTypes.
    const state: SpriteState = kind === 'settler' ? readSpriteState(entity.components) : 'idle';
    const actingAtomic = kind === 'settler' ? readActingAtomic(entity.components) : null;
    const elapsed = kind === 'settler' ? readAtomicElapsed(entity.components) : null;
    const facing = kind === 'settler' ? readFacing(entity.components) : undefined;
    const carrying = kind === 'settler' ? readCarrying(entity.components) : false;
    // A chopping settler shares its tree's cell; nudge its drawn sprite left so the right-swing axe
    // lands in the trunk at the cell centre (render-only — the depth sort below still uses the true tile).
    const chopNudgeX = state === 'acting' && actingAtomic === CHOP_ATOMIC_ID ? CHOP_NUDGE_X : 0;
    sprites.push({
      kind,
      ref: entity.id,
      x: screen.x + chopNudgeX,
      y: screen.y,
      // Feet-anchor depth: lower (greater y), then further-right (greater x), then id. A total order,
      // so the sort is deterministic regardless of snapshot iteration nuances.
      depth: tileY * ROW_STRIDE + tileX,
      state,
      ...(actingAtomic !== null ? { atomicId: actingAtomic } : {}),
      ...(elapsed !== null ? { elapsed } : {}),
      ...(facing !== undefined ? { facing } : {}),
      ...(carrying ? { carrying: true } : {}),
    });
  }

  // Stable, total order: tiles (all negative depth) ahead of sprites, sprites by (y, x, id). The
  // entity-id tie-break makes two sprites on the exact same tile order deterministically.
  sprites.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return [...tiles, ...sprites];
}
