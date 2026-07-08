import type { WorldSnapshot } from '@vinland/sim';
import type { ElevationField } from '../elevation.js';
import { ONE, tileToScreen } from '../iso.js';
import { type Viewport, isVisible } from '../viewport.js';
import { type DrawItem, type MutableDrawItem, SPRITE_PAINT_ORDER, type SpriteState } from './draw-item.js';
import {
  classify,
  facingTowardTile,
  readActingAtomic,
  readAtomicElapsed,
  readAtomicTargetEntity,
  readBuildingType,
  readBuiltPct,
  readCarrying,
  readEngaged,
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

/**
 * The PURE sprite-scene builder — the per-frame half of the scene layer, and the part of rendering an
 * agent CAN self-verify. It turns a {@link WorldSnapshot} into a flat, **depth-sorted** list of sprite
 * draw items in isometric screen space (no Pixi, no canvas, no GPU: plain data the GPU layer walks in
 * order), plus the pre-cull liveness set the retained pool reconciles against. The per-component
 * snapshot reads live in {@link import('./snapshot-readers.js')}; this module owns the projection,
 * the cull, and the depth order.
 *
 * Why floats are fine here: this is `render`, a pure consumer of sim state (docs/ARCHITECTURE.md).
 * The sim stays fixed-point; render reads the snapshot's `Fixed` position (a scaled integer) and
 * divides by ONE to a float tile coordinate. Nothing here feeds back into the sim.
 */

/**
 * Sprite depth packing. A sprite's sort key is `tileY * ROW_STRIDE + tileX`, so the integer-tile
 * `y` dominates and `x` orders within a row — valid only while `tileX < ROW_STRIDE`, which holds for
 * any sane map (sim positions stay well under ~2^25 tiles; real maps are a few hundred). Terrain tiles
 * sit in a band shifted strictly below every sprite (see {@link import('./terrain-scene.js')}).
 */
export const ROW_STRIDE = 4096;

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

/**
 * The atomic id of a combat attack swing — the original's `setatomic <job> 81 "..._attack"` (id 81 is
 * the attack slot across every fighting job; the sim's `ATTACK_ATOMIC_ID`, `systems/conflict/weapons.ts`).
 * A settler mid-attack has stopped moving, so it has no {@link readFacing} heading; it FACES its target
 * instead (the attacker→target screen step). The same numeric contract as the sim, transcribed here (like
 * {@link CHOP_ATOMIC_ID}) rather than imported — render reads the snapshot's plain ids, never sim code.
 */
const ATTACK_ATOMIC_ID = 81;

/** One frame's sprite scene: the culled, depth-sorted draw list PLUS the pre-cull liveness set —
 *  produced in a single pass over the snapshot (see {@link collectSpriteScene}). */
export interface SpriteScene {
  readonly items: DrawItem[];
  /** Ids of ALL drawable entities (before the cull) — the set the retained pool reconciles against
   *  (an id missing here has DIED; one present but not in {@link items} is merely off-screen). */
  readonly liveRefs: ReadonlySet<number>;
}

/**
 * The depth-sorted SPRITE draw list alone (no terrain) — the per-frame half the retained
 * {@link import('../../gpu/world-renderer.js').WorldRenderer} consumes. Terrain is static and built ONCE
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
 * as distinct from ones merely culled off-screen (still live, kept in the pool). A thin view over
 * {@link collectSpriteScene} so the liveness policy has ONE owner (the pool's per-frame path reads the
 * same set from the combined pass instead of calling this). Pure.
 */
export function drawableEntityRefs(snapshot: WorldSnapshot): ReadonlySet<number> {
  return collectSpriteScene(snapshot).liveRefs;
}

/**
 * Build the depth-sorted sprite draw list AND the pre-cull liveness set in one pass over the
 * snapshot's entities — the shared core of {@link import('./terrain-scene.js').buildScene},
 * {@link buildSpriteScene} and the retained pool's per-frame reconcile (which needs both and would
 * otherwise classify every entity twice per frame). Each drawable entity is projected to its feet
 * anchor and tagged with the render-side reads (state/facing/carrying/atomic/buildingType) a per-kind
 * binding needs; when a `viewport` is given, one whose drawn anchor falls outside the framed box is
 * dropped — the per-kind reads run only for the items that survive the cull. Sorted by feet anchor
 * `(y, x)` then entity id — a total, stable order, so culling only removes items without reshuffling
 * the survivors. Pure.
 */
export function collectSpriteScene(
  snapshot: WorldSnapshot,
  viewport?: Viewport,
  elevation?: ElevationField,
): SpriteScene {
  const items: MutableDrawItem[] = [];
  const liveRefs = new Set<number>();
  // A mid-swing attacker faces its target's LIVE position, which needs random access by id (a target may
  // be off-screen / culled, and `WorldSnapshot` carries no id index). Build that index ONLY on a frame
  // that has an attacker — a cheap early-exit scan decides — so economy / `?map` play (no combat) never
  // pays for it. It stores the snapshot's own Position object (readPosition returns it, not a copy), so
  // the fill is N Map.sets with NO per-entity allocation/divide; the `/ONE` to tile space is deferred to
  // the rare attacker lookup below.
  let hasAttacker = false;
  for (const entity of snapshot.entities) {
    if (readActingAtomic(entity.components) === ATTACK_ATOMIC_ID) {
      hasAttacker = true;
      break;
    }
  }
  const posByRef = new Map<number, { x: number; y: number }>();
  if (hasAttacker) {
    for (const entity of snapshot.entities) {
      const p = readPosition(entity.components);
      if (p !== null) posByRef.set(entity.id, p);
    }
  }
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
      // A combat-engaged unit reads the readied `..._agressive` gait (the sim `Engagement` marker).
      if (readEngaged(components)) item.engaged = true;
      // Facing: a mid-attack swing (atomic 81) has no walking heading, so it faces its target's LIVE
      // tile (looked up by id); otherwise the movement heading. Combat facing WINS when it resolves, so
      // a stale path can't leave an attacker swinging at empty air.
      let facing: number | undefined;
      if (actingAtomic === ATTACK_ATOMIC_ID) {
        const targetRef = readAtomicTargetEntity(components);
        const to = targetRef !== null ? posByRef.get(targetRef) : undefined;
        // Divide to tile space only here (the rare swing), not for every entity in the pre-pass.
        if (to !== undefined)
          facing = facingTowardTile({ x: tileX, y: tileY }, { x: to.x / ONE, y: to.y / ONE });
      }
      facing ??= readFacing(components);
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
