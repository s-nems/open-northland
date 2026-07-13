import { type ElevationField, terrainLiftAt } from '../elevation.js';
import type { FogGhost } from '../fog-ghosts.js';
import { ONE, tileToScreen } from '../iso.js';
import { isVisible, type Viewport } from '../viewport.js';
import { type DrawKind, type MutableDrawItem, paintOrderBias } from './draw-item.js';
import { projectileArc } from './projectile-arc.js';
import {
  readAtomicElapsed,
  readCarrying,
  readEngaged,
  readEquipmentWeaponGood,
  readFacing,
  readJobType,
  readOwnerPlayer,
  readProjectileOrigin,
  readProjectileTarget,
} from './snapshot-readers/index.js';

/**
 * The per-item field tagging {@link import('./sprite-scene.js').collectSpriteScene} dispatches to: the
 * feet-anchor depth key, the settler render-side reads, the projectile ballistic arc, and the fog-ghost
 * emit. Split from the scene builder so the main loop reads project → cull → dispatch; each function is a
 * pure "what fields does this kind carry" decision.
 */

/**
 * Sprite depth packing. A sprite's sort key is `tileY * ROW_STRIDE + tileX`, so the integer-tile
 * `y` dominates and `x` orders within a row — valid only while `tileX < ROW_STRIDE`, which holds for
 * any sane map (sim positions stay well under ~2^25 tiles; real maps are a few hundred). Terrain tiles
 * sit in a band shifted strictly below every sprite (see {@link import('./terrain-scene.js')}).
 */
const ROW_STRIDE = 4096;

/** Depth added per {@link paintOrderBias} step in the oracle sort key. `< 1 / maxOrder` so the whole
 *  bias stays under one tile-column (base depths differ by ≥ 1 across cells) and can't cross a cell. */
const PAINT_ORDER_EPS = 1 / 16;

/** The oracle depth key for a sprite at integer-tile `(tileX, tileY)` (x-first, like `tileToScreen`):
 *  the row-major feet-anchor packing (`tileY` dominates, `tileX` orders within a row) plus the sub-cell
 *  {@link paintOrderBias} tiebreak. The live painter's screen-space twin (`sprite-pool.ts`) shares the
 *  same {@link paintOrderBias}, so the two orders can't diverge. */
export function spriteDepth(tileX: number, tileY: number, kind: DrawKind, isFlag = false): number {
  return tileY * ROW_STRIDE + tileX + paintOrderBias(kind, isFlag) * PAINT_ORDER_EPS;
}

/**
 * Tag a settler draw item with the render-side reads a per-character binding needs: the running atomic
 * (+ its elapsed clock), the combat-engaged gait flag, the drawn facing (target-facing wins over the
 * walk heading), the hauled good, the job/weapon look, the owner player LUT row, and the born-young age
 * flag. Assigned (not spread) so an absent fact stays an absent property under exactOptionalPropertyTypes.
 */
export function assignSettlerFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  actingAtomic: number | null,
  targetFacing: number | undefined,
): void {
  if (actingAtomic !== null) {
    item.atomicId = actingAtomic;
    // The action clock rides ALONGSIDE the atomic — omitted when idle (see DrawItem.elapsed), so a
    // kept-indoor settler that still holds a stale CurrentAtomic doesn't carry an orphan elapsed.
    const elapsed = readAtomicElapsed(components);
    if (elapsed !== null) item.elapsed = elapsed;
  }
  // A combat-engaged unit reads the readied `..._agressive` gait (the sim `Engagement` marker).
  if (readEngaged(components)) item.engaged = true;
  // Facing: a mid-attack/mid-harvest swing has no walking heading, so it faces its target's LIVE tile
  // (resolved by the caller); otherwise the movement heading. Target facing WINS when it resolves, so a
  // stale path can't leave an attacker or a woodcutter swinging at empty air.
  const facing = targetFacing ?? readFacing(components);
  if (facing !== undefined) item.facing = facing;
  const carrying = readCarrying(components);
  if (carrying !== null) {
    item.carrying = true;
    if (carrying.goodType !== undefined) item.carryGood = carrying.goodType;
  }
  const jobType = readJobType(components);
  if (jobType !== undefined) item.jobType = jobType;
  // The equipped weapon good drives the drawn warrior look (bow slot → bow body) over the jobType.
  const weaponGood = readEquipmentWeaponGood(components);
  if (weaponGood !== undefined) item.weaponGood = weaponGood;
  const player = readOwnerPlayer(components);
  if (player !== undefined) item.player = player;
  // Only a born-young settler carries `Age` — the component-presence disambiguation of the age-class
  // jobType ids (1..4) from colliding synthetic adult ids (AGENTS.md [dc3ef54]).
  if ('Age' in components) item.young = true;
}

/**
 * Point a projectile draw item along its flight and LOB it (the ballistic-arc trig lives in
 * {@link projectileArc}), returning the ballistic HEIGHT to fold into the draw-lift channel (never the
 * depth key, so the lob can't reshuffle occlusion mid-flight). A shot whose target vanished this frame
 * keeps `rotation` unset and flies flat (lift 0) for the one tick the sim takes to expire it.
 */
export function assignProjectileArc(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  screen: ReturnType<typeof tileToScreen>,
  posByRef: ReadonlyMap<number, { x: number; y: number }>,
): number {
  const targetRef = readProjectileTarget(components);
  const to = targetRef !== null ? posByRef.get(targetRef) : undefined;
  if (to === undefined) return 0;
  const origin = readProjectileOrigin(components);
  const arc = projectileArc(
    screen,
    tileToScreen(to.x / ONE, to.y / ONE),
    origin === null ? null : tileToScreen(origin.x / ONE, origin.y / ONE),
  );
  item.rotation = arc.rotation;
  return arc.lift;
}

/**
 * Append the viewer's remembered statics (`data/fog-ghosts.ts`, pre-filtered to EXPLORED ground) to the
 * draw list: each projects with the SAME anchor/lift/depth formula as a live static (so a ghost occludes
 * correctly against live sprites at the fog boundary) but is tagged {@link DrawItem.ghost} for the pool's
 * grey tint. Every ghost ref joins `liveRefs` — a ghost of a DEAD entity keeps its pooled sprite alive as
 * long as the memory draws; a camera-culled ghost still counts as live but emits no item.
 */
export function pushGhostItems(
  items: MutableDrawItem[],
  liveRefs: Set<number>,
  ghosts: readonly FogGhost[],
  viewport: Viewport | undefined,
  elevation: ElevationField | undefined,
): void {
  for (const g of ghosts) {
    // A ghost keeps its (possibly dead) entity's pooled sprite alive even while camera-culled.
    liveRefs.add(g.ref);
    const screen = tileToScreen(g.tileX, g.tileY);
    if (viewport !== undefined && !isVisible(viewport, screen.x, screen.y)) continue;
    const lift = terrainLiftAt(elevation, g.tileX, g.tileY);
    // Same anchor/depth formula as a live static, so a ghost sorts correctly against live sprites at the
    // fog boundary. Statics are always `idle`; the per-kind fields were frozen at capture.
    const item: MutableDrawItem = {
      kind: g.kind,
      ref: g.ref,
      x: screen.x,
      y: screen.y,
      depth: spriteDepth(g.tileX, g.tileY, g.kind),
      state: 'idle',
      ghost: true,
    };
    if (g.typeId !== undefined) item.typeId = g.typeId;
    if (g.builtPct !== undefined) item.builtPct = g.builtPct;
    if (g.goodType !== undefined) item.goodType = g.goodType;
    if (g.level !== undefined) item.level = g.level;
    if (g.gfxIndex !== undefined) item.gfxIndex = g.gfxIndex;
    if (lift !== 0) item.lift = lift;
    items.push(item);
  }
}
