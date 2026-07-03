import type { WorldSnapshot } from '@vinland/sim';
import { ONE, tileToScreen } from './iso.js';
import { type Viewport, isVisible } from './viewport.js';

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
export type DrawKind = 'tile' | 'building' | 'settler' | 'resource' | 'stockpile' | 'stump' | 'grounddrop';

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
  /**
   * The drawable's type id, so a per-type binding picks the right frame: for a terrain **tile** its
   * landscape typeId (the GPU layer tints/textures by it); for a **building** its `Building.buildingType`
   * (the `[GfxHouse]` `LogicType` — a per-type {@link import('./sprites.js').BuildingTypeBinding} draws
   * each building's own house bob). Omitted for kinds that don't key off a type (settler/resource).
   */
  readonly typeId?: number;
  /**
   * For a **resource** node its `Resource.goodType`, and for a **stockpile** the good its ground pile
   * mainly holds — the key a per-good {@link import('./sprites.js').ResourceTypeBinding} /
   * {@link import('./sprites.js').StockpileBinding} draws each good's own object by (a tree for wood, a
   * rock for stone, a wood pile vs a stone pile). OMITTED for a stockpile that holds nothing — an empty
   * bare `Stockpile` is a bare **delivery flag** (a designated collection point), drawn as the flag
   * sprite rather than a pile. Never set for tiles/buildings/settlers (they key off other fields).
   */
  readonly goodType?: number;
  /**
   * For a **stockpile** ground pile: how many units of its {@link goodType} it holds — the fill amount a
   * {@link import('./sprites.js').StockpileBinding} maps to a per-fill heap frame (a small heap at 1, a
   * full one at the pile's max state), so a pile visibly grows with its contents. OMITTED for an empty
   * pile (a flag) and for every non-stockpile kind.
   */
  readonly fill?: number;
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
  /**
   * For a {@link carrying} settler: the hauled `Carrying.goodType`, so a per-good loaded-gait binding
   * ({@link import('./sprites.js').CarryingBinding.byGood}) draws the RIGHT load (a log for wood, a slab
   * for stone — the original's `..._walk_<good>` bobseq per good). Omitted when not carrying.
   */
  readonly carryGood?: number;
  /**
   * For a settler: its `Settler.jobType` — the key a per-character binding
   * ({@link import('./sprites.js').ByJobTable}) picks the body/head look by (the original's
   * `[jobbasegraphics]` job → body/head join: a soldier draws the armoured `cr_hum_body_05`, a woman
   * `cr_hum_body_10`, …). Omitted when the settler has no job (`jobType` null) — the binding then falls
   * back to its default look.
   */
  readonly jobType?: number;
  /**
   * For a settler: the owning player slot (the sim `Owner.player`), so the renderer can paint the unit in
   * that player's TEAM COLOUR — the render `PalettedSprite` reads its clothing-band indices through the
   * player's row of the `256×N` colour LUT. Omitted for an UNOWNED settler (wildlife / a neutral fixture),
   * which draws the base palette (LUT row 0). This is the render half of the sim's owner-hostility axis.
   */
  readonly player?: number;
  /**
   * For a settler: whether it is a born-young (baby/child) settler — the sim `Age` component is present.
   * Disambiguates the age-class `jobType` ids (1..4) from a synthetic fixture's colliding adult job ids
   * (docs/LESSONS.md [dc3ef54]): only a young settler keys the child/baby body table. Omitted for adults.
   */
  readonly young?: boolean;
  /**
   * For an UNDER-CONSTRUCTION building: its build progress as a whole percent (0..99 — the sim's
   * `Building.built` fixed-point fraction, floored). The construction-stage binding
   * ({@link import('./sprites.js').BuildingTypeBinding.constructionByType}) picks which `[GfxHouse]`
   * construction layers are visible at this progress (the grey foundation at 0, rising stages after).
   * OMITTED for a finished building (`built >= ONE`) — the normal per-type body draw then applies —
   * and for non-building kinds.
   */
  readonly builtPct?: number;
}

/**
 * A decoded map's 1:1 per-triangle ground lanes (the `ground` layer of `content/maps/<id>.json`):
 * pattern `EditName`s + each cell's two triangle picks as indices into them. Render-only data — the
 * renderer joins a name through {@link import('../gpu/pixi-app.js').TerrainTextureSet.groundFor}.
 */
export interface SceneGround {
  readonly patterns: readonly string[];
  /** Row-major per-cell index into {@link patterns} for triangle A (left half of the diamond). */
  readonly a: readonly number[];
  /** Row-major per-cell index into {@link patterns} for triangle B (right half of the diamond). */
  readonly b: readonly number[];
}

/** The terrain grid the snapshot is positioned over (dimensions + row-major landscape typeIds). */
export interface SceneTerrain {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell, length `width*height`. */
  readonly typeIds: readonly number[];
  /** The 1:1 per-triangle ground patterns, when the map carries them (a decoded original map). */
  readonly ground?: SceneGround;
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
  readonly ground?: SceneGround;
}): SceneTerrain {
  return {
    width: map.width,
    height: map.height,
    typeIds: map.typeIds,
    ...(map.ground !== undefined ? { ground: map.ground } : {}),
  };
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
  // A felled tree's leftover stump/debris — pure decor (a Position + Stump marker, no other drawable
  // component), drawn by a per-good {@link import('./sprites.js').ResourceTypeBinding} like a resource
  // node but from the dead-tree/debris atlas. Checked before Settler/Stockpile (a stump is neither).
  if ('Stump' in components) return 'stump';
  if ('Settler' in components) return 'settler';
  // A freshly-felled trunk still on the ground (a Stockpile carrying the GroundDrop marker) draws its
  // pickup-stage LOG graphic, distinct from a tidy delivery pile — the original shows a different object
  // for uncollected harvest than for the stored heap. Checked before the plain Stockpile so a marked drop
  // never falls through to the flag/heap path.
  if ('GroundDrop' in components && 'Stockpile' in components) return 'grounddrop';
  // A bare Stockpile with NO Building is a loose ground pile or a delivery flag (the gathering economy's
  // dropped goods + collection points, spawned by ai-supply.ts). Checked AFTER Building so a warehouse/HQ
  // store — which carries both Building and Stockpile — stays a `building`, matching the sim's own
  // ground-pile rule (`nearestGroundPile`: Stockpile ∧ Position ∧ ¬Building).
  if ('Stockpile' in components) return 'stockpile';
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
 * A building entity's type id — the `Building.buildingType` (the `[GfxHouse]` `LogicType` the placement
 * command stamped). Stamped onto the building draw item as {@link DrawItem.typeId} so a per-type
 * {@link import('./sprites.js').BuildingTypeBinding} can draw each building its own house bob. Returns
 * `undefined` for a missing/malformed component (the binding then falls back to its default house). Pure
 * read of plain snapshot data — never re-enters the sim.
 */
function readBuildingType(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.Building as { buildingType?: unknown } | undefined;
  return b !== undefined && typeof b.buildingType === 'number' ? b.buildingType : undefined;
}

/**
 * An UNDER-CONSTRUCTION building's progress as a whole percent (0..99), or `undefined` for a finished
 * building (`built >= ONE` — the normal body draw applies) or a missing/malformed component. The sim's
 * `Building.built` is a fixed-point fraction of ONE; the floor keeps a nearly-done site below 100 so
 * the construction stages stay up until the finish tick flips the draw to the completed body. Pure
 * read of plain snapshot data — never re-enters the sim.
 */
function readBuiltPct(components: Readonly<Record<string, unknown>>): number | undefined {
  const b = components.Building as { built?: unknown } | undefined;
  if (b === undefined || typeof b.built !== 'number' || !Number.isFinite(b.built) || b.built >= ONE) {
    return undefined; // finished (or malformed — NaN would poison every range test downstream)
  }
  return Math.max(0, Math.min(99, Math.floor((b.built * 100) / ONE)));
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
 * mid-atomic (`CurrentAtomic`) ⇒ `acting`, else IN TRANSIT (a live path OR a pending goal) ⇒ `moving`,
 * else `idle`. Acting wins over moving because a settler that started an atomic has stopped to act even
 * if a stale path lingers. Pure read of plain snapshot data — never re-enters the sim.
 *
 * "In transit" is more than a live {@link PathFollow}: a unit re-issuing its route drops the PathFollow
 * for a tick while it still holds a {@link MoveGoal} / a freshly-queued {@link PathRequest} — most
 * visibly a combat chaser, which re-paths toward a MOVING enemy every few ticks (systems/conflict
 * `REPATH_CADENCE`). Treating that gap as `idle` made the walk animation drop to the standing pose for a
 * frame each tile — the reported march "stutter". A **failed** PathRequest is the opposite case: the goal
 * is unreachable and the unit is genuinely stuck, so it stays `idle` rather than moonwalk in place.
 */
function readSpriteState(components: Readonly<Record<string, unknown>>): SpriteState {
  if (readActingAtomic(components) !== null) return 'acting';
  if ('PathFollow' in components) return 'moving';
  const req = components.PathRequest as { failed?: unknown } | undefined;
  if (req !== undefined) return req.failed === true ? 'idle' : 'moving';
  if ('MoveGoal' in components) return 'moving';
  return 'idle';
}

/**
 * What a snapshot settler is hauling — the (plain-cloned) `Carrying` component's `goodType` (the sim
 * adds the component on harvest, removes it on deposit), or `null` when it carries nothing. Read as a
 * fact orthogonal to {@link readSpriteState} so a binding can pick the loaded gait (and the per-good
 * look) while the settler still reads as `moving`/`acting`. A present-but-malformed component still
 * reads as carrying (goodType `undefined` → the generic loaded look). Pure read of plain snapshot data.
 */
function readCarrying(components: Readonly<Record<string, unknown>>): { goodType?: number } | null {
  const c = components.Carrying as { goodType?: unknown } | undefined;
  if (c === undefined) return null;
  return typeof c.goodType === 'number' ? { goodType: c.goodType } : {};
}

/**
 * A settler's `Settler.jobType` — the per-character body/head join key ({@link DrawItem.jobType}) — or
 * `undefined` for a jobless (`null`) settler / malformed component (the binding then falls back to its
 * default look). Pure read of plain snapshot data — never re-enters the sim.
 */
function readJobType(components: Readonly<Record<string, unknown>>): number | undefined {
  const s = components.Settler as { jobType?: unknown } | undefined;
  return s !== undefined && typeof s.jobType === 'number' ? s.jobType : undefined;
}

/**
 * A resource node's `Resource.goodType` — the per-good join key ({@link DrawItem.goodType}) a
 * {@link import('./sprites.js').ResourceTypeBinding} draws its species/deposit by (a tree for wood, a
 * mine for iron). `undefined` for a missing/malformed component (the binding then falls back to its
 * default node). Pure read of plain snapshot data — never re-enters the sim.
 */
function readResourceGood(components: Readonly<Record<string, unknown>>): number | undefined {
  const r = components.Resource as { goodType?: unknown } | undefined;
  return r !== undefined && typeof r.goodType === 'number' ? r.goodType : undefined;
}

/**
 * A stump's `Stump.goodType` — the resource it is the remains of (a chopped tree → wood), the per-good
 * join key ({@link DrawItem.goodType}) a {@link import('./sprites.js').ResourceTypeBinding} draws its
 * debris frame by. `undefined` for a missing/malformed component (the binding falls back to its
 * default). Pure read of plain snapshot data — never re-enters the sim.
 */
function readStumpGood(components: Readonly<Record<string, unknown>>): number | undefined {
  const s = components.Stump as { goodType?: unknown } | undefined;
  return s !== undefined && typeof s.goodType === 'number' ? s.goodType : undefined;
}

/**
 * What a bare {@link import('@vinland/sim').Stockpile} draw item represents: the good its ground pile
 * mainly holds + how many units (its per-fill heap frame), or `{}` when it holds nothing — an empty pile
 * is a bare **delivery flag**. The snapshot clones a `Stockpile.amounts` Map to an ascending-by-goodType
 * `[goodType, amount]` array (see `inspect/snapshot.ts`), so this reads that plain shape. The pile's good
 * is the one it holds MOST of (strict `>` keeps the FIRST max — i.e. the lowest goodType on a tie,
 * *because* the snapshot pre-sorts `amounts` ascending by goodType). That canonical order is what makes
 * the pick reproducible across runs. A pile in the gathering economy holds a single good, so this is
 * unambiguous there; the max rule just keeps a mixed heap deterministic. Pure.
 */
function readStockpile(components: Readonly<Record<string, unknown>>): {
  goodType?: number;
  fill?: number;
} {
  const s = components.Stockpile as { amounts?: unknown } | undefined;
  if (s === undefined || !Array.isArray(s.amounts)) return {};
  let bestGood: number | undefined;
  let bestAmount = 0;
  for (const pair of s.amounts) {
    if (!Array.isArray(pair)) continue;
    const good = pair[0];
    const amount = pair[1];
    if (typeof good !== 'number' || typeof amount !== 'number' || amount <= 0) continue;
    if (amount > bestAmount) {
      bestAmount = amount;
      bestGood = good;
    }
  }
  return bestGood === undefined ? {} : { goodType: bestGood, fill: bestAmount };
}

/**
 * The owning player slot of a settler — the sim `Owner.player`, the render team-colour key ({@link
 * DrawItem.player}). `undefined` when the settler carries no `Owner` (wildlife / a neutral fixture), which
 * the renderer draws in the base palette. Pure read of plain snapshot data.
 */
function readOwnerPlayer(components: Readonly<Record<string, unknown>>): number | undefined {
  const o = components.Owner as { player?: unknown } | undefined;
  return o !== undefined && typeof o.player === 'number' ? o.player : undefined;
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
 *
 * NOTE: the live render path is {@link WorldRenderer}, which projects terrain itself and consumes
 * {@link buildSpriteScene} (sprites only) — it no longer calls `buildScene`. `buildScene` is retained as
 * the **headless oracle** for the projection + depth-ordering the renderer must match (its tests pin
 * back-to-front terrain + feet-anchor sprite order that a Pixi renderer can't easily unit-test).
 * KNOWN DIVERGENCE: the live renderer's painter key is the feet-anchor SCREEN y (∝ row under the
 * staggered raster, so static map objects interleave correctly), while this oracle's sprite key is row-major
 * `(tileY, tileX)` — the two orders differ for items more than a row apart on one screen band. The
 * terrain-projection duplication between here and `WorldRenderer.buildFlatTerrain`/`buildTexturedTerrain`
 * is logged in `docs/TECH-DEBT.md` — they share the `terrain.ts` helpers, so they can't silently diverge.
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
      // Tiles sort among themselves back-to-front (ascending row — under the staggered raster,
      // diamonds interlock only across rows, and a same-row pair never overlaps), shifted into a
      // band strictly below every sprite depth (sprite depths are >= 0 world rows; tiles negative).
      depth: TILE_DEPTH_BASE + row,
      typeId,
    });
  }

  // Stable, total order: tiles (all negative depth) ahead of sprites, sprites by (y, x, id).
  return [...tiles, ...collectSprites(snapshot)];
}

/**
 * The depth-sorted SPRITE draw list alone (no terrain) — the per-frame half the retained
 * {@link import('../gpu/world-renderer.js').WorldRenderer} consumes. Terrain is static and built ONCE
 * (`setTerrain`), so it no longer flows through the per-frame path; this emits only the
 * moving/animated entities. Pass a `viewport` to CULL to what the camera frames (an item is kept iff
 * its screen anchor is inside the — already margin-inflated — box); culling changes *which* items are
 * emitted, never their relative order, so the retained pool + depth-sort stay correct. Absent a
 * viewport, every sprite is emitted (the whole-map / fully-zoomed-out case). Pure.
 */
export function buildSpriteScene(snapshot: WorldSnapshot, viewport?: Viewport): DrawItem[] {
  return collectSprites(snapshot, viewport);
}

/**
 * The set of entity ids that draw as a sprite (a drawable marker + a Position) — the liveness set the
 * retained pool reconciles against to DESTROY sprites of entities that have left the snapshot (died),
 * as distinct from ones merely culled off-screen (still live, kept in the pool). Pure.
 */
export function drawableEntityRefs(snapshot: WorldSnapshot): Set<number> {
  const refs = new Set<number>();
  for (const entity of snapshot.entities) {
    if (classify(entity.components) === null) continue;
    if (readPosition(entity.components) === null) continue;
    refs.add(entity.id);
  }
  return refs;
}

/**
 * Build the depth-sorted sprite draw list from the snapshot's entities — the shared core of
 * {@link buildScene} and {@link buildSpriteScene}. Each drawable entity is projected to its feet anchor
 * and tagged with the render-side reads (state/facing/carrying/atomic/buildingType) a per-kind binding
 * needs; when a `viewport` is given, one whose drawn anchor falls outside the framed box is dropped.
 * Sorted by feet anchor `(y, x)` then entity id — a total, stable order (the same property the
 * pre-split list had), so culling only removes items without reshuffling the survivors. Pure.
 */
function collectSprites(snapshot: WorldSnapshot, viewport?: Viewport): DrawItem[] {
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
    const carrying = kind === 'settler' ? readCarrying(entity.components) : null;
    const jobType = kind === 'settler' ? readJobType(entity.components) : undefined;
    const player = kind === 'settler' ? readOwnerPlayer(entity.components) : undefined;
    // Only a born-young settler carries `Age` — the component-presence disambiguation of the age-class
    // jobType ids (1..4) from colliding synthetic adult ids (docs/LESSONS.md [dc3ef54]).
    const young = kind === 'settler' && 'Age' in entity.components;
    // A building carries its type id so a per-type binding draws its own house bob (the `[GfxHouse]`
    // `LogicType` → `GfxBobId` join); other kinds key off no type, so it's omitted for them.
    const buildingType = kind === 'building' ? readBuildingType(entity.components) : undefined;
    // An under-construction building carries its progress percent so the construction-stage binding
    // can pick the visible `[GfxHouse]` layers (grey foundation → stages → completed body).
    const builtPct = kind === 'building' ? readBuiltPct(entity.components) : undefined;
    // A resource node carries its `Resource.goodType` so a per-good binding draws its own species/deposit;
    // a bare stockpile carries the good its pile holds most of (+ the fill amount), or nothing when it is a
    // delivery flag. Both feed the per-good {@link ResourceTypeBinding}/{@link StockpileBinding}.
    const resourceGood = kind === 'resource' ? readResourceGood(entity.components) : undefined;
    const stumpGood = kind === 'stump' ? readStumpGood(entity.components) : undefined;
    // A plain flag/pile AND a loose GroundDrop trunk both read their held good + fill from the stockpile —
    // the trunk keys its per-good pickup graphic off `goodType`, the flag its heap frame off `goodType`+fill.
    const stockpile =
      kind === 'stockpile' || kind === 'grounddrop' ? readStockpile(entity.components) : undefined;
    const goodType = kind === 'resource' ? resourceGood : kind === 'stump' ? stumpGood : stockpile?.goodType;
    // A chopping settler shares its tree's cell; nudge its drawn sprite left so the right-swing axe
    // lands in the trunk at the cell centre (render-only — the depth sort below still uses the true tile).
    const chopNudgeX = state === 'acting' && actingAtomic === CHOP_ATOMIC_ID ? CHOP_NUDGE_X : 0;
    const drawX = screen.x + chopNudgeX;
    // Cull to the framed viewport (when culling). Uses the DRAWN anchor; the box is pre-inflated by the
    // renderer to cover a tall sprite's extent, so a building straddling the edge still draws.
    if (viewport !== undefined && !isVisible(viewport, drawX, screen.y)) continue;
    sprites.push({
      kind,
      ref: entity.id,
      x: drawX,
      y: screen.y,
      // Feet-anchor depth: lower (greater y), then further-right (greater x), then id. A total order,
      // so the sort is deterministic regardless of snapshot iteration nuances.
      depth: tileY * ROW_STRIDE + tileX,
      state,
      ...(actingAtomic !== null ? { atomicId: actingAtomic } : {}),
      ...(elapsed !== null ? { elapsed } : {}),
      ...(facing !== undefined ? { facing } : {}),
      ...(carrying !== null ? { carrying: true } : {}),
      ...(carrying?.goodType !== undefined ? { carryGood: carrying.goodType } : {}),
      ...(jobType !== undefined ? { jobType } : {}),
      ...(player !== undefined ? { player } : {}),
      ...(young ? { young: true } : {}),
      ...(buildingType !== undefined ? { typeId: buildingType } : {}),
      ...(builtPct !== undefined ? { builtPct } : {}),
      ...(goodType !== undefined ? { goodType } : {}),
      ...(stockpile?.fill !== undefined ? { fill: stockpile.fill } : {}),
    });
  }
  // Stable, total order: sprites by (y, x, id). The entity-id tie-break makes two sprites on the exact
  // same tile order deterministically.
  sprites.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return sprites;
}
