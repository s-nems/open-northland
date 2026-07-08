import type { WorldSnapshot } from '@vinland/sim';
import type { ElevationField } from './elevation.js';
import { ONE, tileToScreen } from './iso.js';
import {
  classify,
  readActingAtomic,
  readAtomicElapsed,
  readBuildingType,
  readBuiltPct,
  readCarrying,
  readFacing,
  readJobType,
  readOwnerPlayer,
  readPosition,
  readResourceGood,
  readResourceLevel,
  readSpriteState,
  readStockpile,
  readStumpGood,
} from './snapshot-readers.js';
import { type Viewport, isVisible } from './viewport.js';

/**
 * The PURE scene-building layer — the part of rendering an agent CAN self-verify.
 *
 * It turns a {@link WorldSnapshot} (+ the terrain grid dimensions) into a flat, **depth-sorted**
 * list of draw items in isometric screen space. No Pixi, no canvas, no GPU: this is plain data the
 * GPU layer (the un-self-verifiable pixel half, deferred to a human) walks in order. Keeping the
 * projection + depth-sort here means the load-bearing render logic — *which* item draws *where* and
 * *in what order* — is unit-testable without a screen (see test/scene.test.ts). The per-component
 * snapshot reads live in {@link import('./snapshot-readers.js')}; this module owns the projection,
 * the cull, and the depth order.
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
 * Same-feet-anchor paint priority per drawable kind — a higher value draws LATER (in front) when two
 * sprites resolve to (nearly) the same depth. A worker STANDS ON the resource cell it harvests and a
 * delivery flag SITS ON the ground drops piling up around it, so without a tiebreak the taller node/drop
 * paints over the unit/flag by mere attach order. The rule the eye expects: the **settler** is the focus
 * and sits in front of the terrain node/stump it works, and the **flag/pile** (`stockpile`) sits in front
 * of the loose `grounddrop` ore/logs. Applied as a sub-cell epsilon ({@link PAINT_ORDER_EPS}) — orders of
 * magnitude below one row's depth separation — so it ONLY breaks ties at a shared anchor and never
 * reorders sprites that are a genuine row apart. `tile` is 0 (tiles carry their own sub-zero depth band).
 */
export const SPRITE_PAINT_ORDER: Readonly<Record<DrawKind, number>> = {
  tile: 0,
  resource: 0,
  stump: 0,
  building: 1,
  grounddrop: 1,
  stockpile: 2,
  settler: 3,
};
/** Depth added per {@link SPRITE_PAINT_ORDER} step in the oracle sort key. `< 1 / maxOrder` so the whole
 *  bias stays under one tile-column (base depths differ by ≥ 1 across cells) and can't cross a cell. */
const PAINT_ORDER_EPS = 1 / 16;

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
 * sim state the plan calls "animation playback driven by each entity's logical state"; it never
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
  /**
   * For a **mined resource node** (a {@link import('@vinland/sim').MineDeposit} deposit): its visual fill
   * LEVEL — a small integer in `[1, levels]`, `levels` when the deposit is full stepping down to `1` as it
   * nears empty. A per-good {@link import('./sprites.js').ResourceTypeBinding} indexes the mine record's
   * fill-state frames by it, so the drawn deposit visibly SHRINKS in step with what has been mined (the
   * node twin of a pile's {@link fill}). OMITTED for a plain node (a tree/mushroom/full showcase deposit),
   * which draws its full-state frame — so an unmined node is unaffected.
   */
  readonly level?: number;
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
   * face (read off the decoded frames, `source basis` "Settler facing"): `0 SW, 1 W, 2 NW, 3 NE,
   * 4 E, 5 SE, 6 S, 7 N`. Derived from the live {@link import('./snapshot-readers.js').readFacing}
   * heading; omitted when the settler isn't moving (the binding then falls back to
   * {@link import('./sprites.js').DEFAULT_FACING}).
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
   * (AGENTS.md [dc3ef54]): only a young settler keys the child/baby body table. Omitted for adults.
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
  /**
   * The terrain-elevation lift (world px, ≥ 0) at this item's feet — subtracted from the DRAWN `y` so
   * the sprite sits on the lifted ground (a settler on a hill rides up with it). ORTHOGONAL to {@link
   * x}/{@link y}: the anchor and its {@link depth} stay PRE-LIFT (the painter key must remain the feet
   * row, so a lifted-up sprite on a nearer row still occludes one behind it — the renderer draws at
   * `y − lift` but sorts by `y`). Omitted (treated as 0) on a flat map / synthetic content.
   */
  readonly lift?: number;
}

/** The mutable twin of {@link DrawItem}, used only while one item is being assembled (the fields are
 *  conditionally ASSIGNED instead of conditionally spread — a spread per optional field allocates a
 *  throwaway object each, a real per-frame GC cost at thousands of sprites × 60 fps). */
type MutableDrawItem = { -readonly [K in keyof DrawItem]: DrawItem[K] };

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
  /**
   * The decoded map's per-cell `lmhe` terrain height (row-major, length `width*height`, 0..~250), when
   * present. The renderer builds an {@link import('./elevation.js').ElevationField} from it to lift the
   * ground mesh + every projected item; absent → flat (no lift). Render-only data — the sim never reads it.
   */
  readonly elevation?: readonly number[];
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
  readonly elevation?: readonly number[];
}): SceneTerrain {
  return {
    width: map.width,
    height: map.height,
    typeIds: map.typeIds,
    ...(map.ground !== undefined ? { ground: map.ground } : {}),
    ...(map.elevation !== undefined ? { elevation: map.elevation } : {}),
  };
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
 * is logged in `docs/plans/` — they share the `terrain.ts` helpers, so they can't silently diverge.
 */
export function buildScene(
  snapshot: WorldSnapshot,
  terrain: SceneTerrain,
  elevation?: ElevationField,
): DrawItem[] {
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
  return [...tiles, ...collectSpriteScene(snapshot, undefined, elevation).items];
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
export function buildSpriteScene(
  snapshot: WorldSnapshot,
  viewport?: Viewport,
  elevation?: ElevationField,
): DrawItem[] {
  return collectSpriteScene(snapshot, viewport, elevation).items;
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

/** One frame's sprite scene: the culled, depth-sorted draw list PLUS the pre-cull liveness set —
 *  produced in a single pass over the snapshot (see {@link collectSpriteScene}). */
export interface SpriteScene {
  readonly items: DrawItem[];
  /** Ids of ALL drawable entities (before the cull) — the set the retained pool reconciles against
   *  (an id missing here has DIED; one present but not in {@link items} is merely off-screen). */
  readonly liveRefs: ReadonlySet<number>;
}

/**
 * Build the depth-sorted sprite draw list AND the pre-cull liveness set in one pass over the
 * snapshot's entities — the shared core of {@link buildScene}, {@link buildSpriteScene} and the
 * retained pool's per-frame reconcile (which needs both and would otherwise classify every entity
 * twice per frame). Each drawable entity is projected to its feet anchor and tagged with the
 * render-side reads (state/facing/carrying/atomic/buildingType) a per-kind binding needs; when a
 * `viewport` is given, one whose drawn anchor falls outside the framed box is dropped — the per-kind
 * reads run only for the items that survive the cull. Sorted by feet anchor `(y, x)` then entity id —
 * a total, stable order, so culling only removes items without reshuffling the survivors. Pure.
 */
export function collectSpriteScene(
  snapshot: WorldSnapshot,
  viewport?: Viewport,
  elevation?: ElevationField,
): SpriteScene {
  const items: MutableDrawItem[] = [];
  const liveRefs = new Set<number>();
  for (const entity of snapshot.entities) {
    const components = entity.components;
    const kind = classify(components);
    if (kind === null) continue;
    const pos = readPosition(components);
    if (pos === null) continue;
    liveRefs.add(entity.id);
    // Fixed (scaled int) -> float tile coordinate. Render-only; never re-enters the sim.
    const tileX = pos.x / ONE;
    const tileY = pos.y / ONE;
    const screen = tileToScreen(tileX, tileY);
    // Only settlers animate per-state in this slice; a building/resource is always idle. State (and
    // the chop atomic) must be read BEFORE the cull because the chop nudge moves the drawn anchor.
    const state: SpriteState = kind === 'settler' ? readSpriteState(components) : 'idle';
    const actingAtomic = kind === 'settler' ? readActingAtomic(components) : null;
    // A chopping settler shares its tree's cell; nudge its drawn sprite left so the right-swing axe
    // lands in the trunk at the cell centre (render-only — the depth sort below still uses the true tile).
    const chopNudgeX = state === 'acting' && actingAtomic === CHOP_ATOMIC_ID ? CHOP_NUDGE_X : 0;
    const drawX = screen.x + chopNudgeX;
    // Cull to the framed viewport (when culling). Uses the DRAWN anchor; the box is pre-inflated by the
    // renderer to cover a tall sprite's extent, so a building straddling the edge still draws.
    if (viewport !== undefined && !isVisible(viewport, drawX, screen.y)) continue;
    // Terrain lift at the feet (bilinear over the elevation lane) — the DRAW offset, NOT the depth key.
    // The anchor/`depth` below stay PRE-LIFT so occlusion sorts by map row, not by lifted screen y.
    // A flat map (`maxLift === 0`) skips the sampler entirely — the elevation-free path stays free.
    const lift = elevation !== undefined && elevation.maxLift > 0 ? elevation.liftAt(tileX, tileY) : 0;
    const item: MutableDrawItem = {
      kind,
      ref: entity.id,
      x: drawX,
      y: screen.y,
      // Feet-anchor depth: lower (greater y), then further-right (greater x), then a per-kind sub-cell
      // bias (a settler in front of the node it stands on, a flag in front of its ground drops), then id.
      // A total order, so the sort is deterministic regardless of snapshot iteration nuances.
      depth: tileY * ROW_STRIDE + tileX + SPRITE_PAINT_ORDER[kind] * PAINT_ORDER_EPS,
      state,
    };
    // Per-kind reads, ASSIGNED (not spread) so an absent fact stays an absent property under
    // exactOptionalPropertyTypes without a throwaway spread object per field.
    if (kind === 'settler') {
      if (actingAtomic !== null) item.atomicId = actingAtomic;
      const elapsed = readAtomicElapsed(components);
      if (elapsed !== null) item.elapsed = elapsed;
      const facing = readFacing(components);
      if (facing !== undefined) item.facing = facing;
      const carrying = readCarrying(components);
      if (carrying !== null) {
        item.carrying = true;
        if (carrying.goodType !== undefined) item.carryGood = carrying.goodType;
      }
      const jobType = readJobType(components);
      if (jobType !== undefined) item.jobType = jobType;
      const player = readOwnerPlayer(components);
      if (player !== undefined) item.player = player;
      // Only a born-young settler carries `Age` — the component-presence disambiguation of the age-class
      // jobType ids (1..4) from colliding synthetic adult ids (AGENTS.md [dc3ef54]).
      if ('Age' in components) item.young = true;
    } else if (kind === 'building') {
      // A building carries its type id so a per-type binding draws its own house bob (the `[GfxHouse]`
      // `LogicType` → `GfxBobId` join), and — while under construction — its progress percent so the
      // construction-stage binding can pick the visible layers (grey foundation → stages → body).
      const typeId = readBuildingType(components);
      if (typeId !== undefined) item.typeId = typeId;
      const builtPct = readBuiltPct(components);
      if (builtPct !== undefined) item.builtPct = builtPct;
    } else if (kind === 'resource') {
      // A resource node carries its `Resource.goodType` so a per-good binding draws its own
      // species/deposit; a MINED node also carries its shrink-by-level fill state so its deposit graphic
      // steps down as it empties (a plain tree/mushroom/full deposit reads no level → full-state frame).
      const goodType = readResourceGood(components);
      if (goodType !== undefined) item.goodType = goodType;
      const level = readResourceLevel(components);
      if (level !== undefined) item.level = level;
    } else if (kind === 'stump') {
      const goodType = readStumpGood(components);
      if (goodType !== undefined) item.goodType = goodType;
    } else {
      // stockpile | grounddrop: both read their held good + fill from the stockpile — the trunk keys its
      // per-good pickup graphic off `goodType`, the flag/heap its per-fill frame off `goodType`+`fill`.
      const { goodType, fill } = readStockpile(components);
      if (goodType !== undefined) item.goodType = goodType;
      if (fill !== undefined) item.fill = fill;
    }
    if (lift !== 0) item.lift = lift;
    items.push(item);
  }
  // Stable, total order: sprites by (y, x, id). The entity-id tie-break makes two sprites on the exact
  // same tile order deterministically.
  items.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return { items, liveRefs };
}
