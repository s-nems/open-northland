import type { WorldSnapshot } from '@open-northland/sim';
import type { FogGhost } from '../fog/index.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../projection/index.js';
import { type ElevationField, terrainLiftAt } from '../terrain/index.js';
import { spriteDepth } from './depth.js';
import type { MutableDrawItem, MutableSpriteDrawItem } from './draw-item.js';
import { COVER_LAUNCH_HEIGHT_PX, projectileArc } from './projectile-arc.js';
import { SIGNPOST_BOARD_FRAMES, signpostBoardsOf } from './signpost-boards.js';
import {
  assignStaticFields,
  copyStaticFields,
  readAtomicElapsed,
  readBerryBushGfxIndex,
  readBerryBushLevel,
  readCarrying,
  readEngaged,
  readEquipmentArmorGood,
  readEquipmentWeaponGood,
  readFacing,
  readHpFraction,
  readJobType,
  readOwnerPlayer,
  readProducing,
  readProjectileCover,
  readProjectileMissAim,
  readProjectileOrigin,
  readProjectileTarget,
  readSettlerTribe,
  readStockpile,
  readUpgradePct,
} from './snapshot-readers/index.js';

/**
 * The per-item field tagging {@link import('./sprite-scene.js').collectSpriteScene} dispatches to: the
 * per-kind render-side reads, the projectile ballistic arc, the signpost board emit, and the fog-ghost
 * emit. Split from the scene builder so the main loop reads project → cull → dispatch; each function is
 * a pure "what fields does this kind carry" decision. Fields are assigned (not spread) so an absent
 * fact stays an absent property under exactOptionalPropertyTypes without a throwaway spread object per
 * field.
 */

/**
 * Tag a settler draw item with the render-side reads a per-character binding needs: the running atomic
 * (+ its elapsed clock), the combat-engaged gait flag, the drawn facing (target-facing wins over the
 * walk heading), the hauled good, the job/weapon look, the owner player LUT row, and the born-young age
 * flag.
 */
export function assignSettlerFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  actingAtomic: number | null,
  targetFacing: number | undefined,
): void {
  if (actingAtomic !== null) {
    item.atomicId = actingAtomic;
    // The action clock rides alongside the atomic - omitted when idle (see DrawItem.elapsed), so a
    // kept-indoor settler that still holds a stale CurrentAtomic doesn't carry an orphan elapsed.
    const elapsed = readAtomicElapsed(components);
    if (elapsed !== null) item.elapsed = elapsed;
  }
  // A combat-engaged unit reads the readied `..._agressive` gait (the sim `Engagement` marker).
  if (readEngaged(components)) item.engaged = true;
  // Facing: a mid-attack/mid-harvest swing has no walking heading, so it faces its target's live tile
  // (resolved by the caller); otherwise the movement heading. Target facing wins when it resolves, so a
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
  // The tribe rides on every settler; the animal species table keys its body look by it.
  const tribe = readSettlerTribe(components);
  if (tribe !== undefined) item.tribe = tribe;
  // The equipped weapon good drives the drawn warrior look (bow slot → bow body) over the jobType;
  // null (an Equipment with an empty weapon slot) drives the bare-hands warrior body instead.
  const weaponGood = readEquipmentWeaponGood(components);
  if (weaponGood !== undefined) item.weaponGood = weaponGood;
  // The worn armor good drives the armor recolor (the (tier, player) palette LUT row).
  const armorGood = readEquipmentArmorGood(components);
  if (armorGood !== undefined) item.armorGood = armorGood;
  const player = readOwnerPlayer(components);
  if (player !== undefined) item.player = player;
  // Only a born-young settler carries `Age` - the component-presence disambiguation of the age-class
  // jobType ids (1..4) from colliding synthetic adult ids (AGENTS.md [dc3ef54]).
  if ('Age' in components) item.young = true;
}

/**
 * Tag a building draw item: its type id + construction progress (the shared static fields a fog ghost
 * also carries) plus the live-only reads a ghost never shows: the upgrade progress revealing the next
 * tier over the old body, the mid-production switch a type's animated state overlay flips on (the
 * mill's rotor), and a damaged finished building's remaining HP fraction (the damage-smoke drive).
 */
export function assignBuildingFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
): void {
  assignStaticFields(item, 'building', components);
  const upgradePct = readUpgradePct(components);
  if (upgradePct !== undefined) item.upgradePct = upgradePct;
  if (readProducing(components)) item.working = true;
  const hpFrac = readHpFraction(components);
  if (hpFrac !== undefined) item.hpFrac = hpFrac;
}

/** Tag a berry bush: its render-variant `gfxIndex` (the fruited-bush record, i.e. its species) and a
 *  ripe/bare level (2 = fruited, 1 = bare), so its per-variant two-frame binding draws the state the
 *  sim last set (foraged → bare, regrown → ripe). */
export function assignBerryBushFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
): void {
  const gfxIndex = readBerryBushGfxIndex(components);
  if (gfxIndex !== undefined) item.gfxIndex = gfxIndex;
  const level = readBerryBushLevel(components);
  if (level !== undefined) item.level = level;
}

/** Tag a ground pile / delivery flag / trunk drop with its held good and fill - the trunk keys its
 *  per-good pickup graphic off `goodType`, the flag/heap its per-fill frame off `goodType`+`fill`. A
 *  designated delivery flag is tagged for the resolver (its paint-above-the-heap bump already rides
 *  the depth key the caller computed). */
export function assignStockpileFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  isFlag: boolean,
): void {
  const { goodType, fill } = readStockpile(components);
  if (goodType !== undefined) item.goodType = goodType;
  if (fill !== undefined) item.fill = fill;
  if (isFlag) item.isFlag = true;
}

/**
 * Tag a signpost post with its owner and append one direction-board item per connected in-range
 * neighbour at the same feet anchor (the board frames' offsets carry the post-top pivot), painted the
 * flag half-step above the post. Synthetic negative refs keep the boards pooled/reconciled per
 * (signpost, angle-bucket) without colliding with real entity ids. The post's ribbon and runic
 * lettering are the team colour - the owner picks the baked per-player guidepost atlas; each board
 * reads the same owner, colour-mapped here because boards bypass the caller's shared push site (the
 * post itself is mapped there).
 */
export function pushSignpostItems(
  items: MutableSpriteDrawItem[],
  liveRefs: Set<number>,
  snapshot: WorldSnapshot,
  item: MutableSpriteDrawItem,
  components: Readonly<Record<string, unknown>>,
  tileX: number,
  tileY: number,
  lift: number,
  playerColourOf: ((player: number) => number) | undefined,
): void {
  const postPlayer = readOwnerPlayer(components);
  if (postPlayer !== undefined) item.player = postPlayer;
  for (const bucket of signpostBoardsOf(snapshot).get(item.ref) ?? []) {
    const boardRef = -(item.ref * (SIGNPOST_BOARD_FRAMES + 1) + bucket + 1);
    liveRefs.add(boardRef);
    const board: MutableSpriteDrawItem = {
      kind: 'signpost',
      ref: boardRef,
      x: item.x,
      y: item.y,
      depth: spriteDepth(tileX, tileY, 'signpost', true),
      state: 'idle',
      boardIndex: bucket,
    };
    if (postPlayer !== undefined) {
      board.player = playerColourOf === undefined ? postPlayer : playerColourOf(postPlayer);
    }
    if (lift !== 0) board.lift = lift;
    items.push(board);
  }
}

/**
 * Point a projectile draw item along its flight and lob it (the ballistic-arc trig lives in
 * {@link projectileArc}), returning the ballistic height to fold into the draw-lift channel (never the
 * depth key, so the lob can't reshuffle occlusion mid-flight). A shot with a frozen aim (missed, or
 * stranded when its mark fell) ends its chord there ({@link readProjectileMissAim}) rather than at the
 * live target - tracking the runner would bend the nose and stall the lob. A shot with neither a live
 * target nor an aim keeps `rotation` unset and flies flat (lift 0) for the one tick the sim takes to
 * clear it.
 */
export function assignProjectileArc(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  screen: ReturnType<typeof tileToScreen>,
  posByRef: ReadonlyMap<number, { x: number; y: number }>,
): number {
  const missAim = readProjectileMissAim(components);
  const targetRef = missAim === null ? readProjectileTarget(components) : null;
  const to = missAim ?? (targetRef !== null ? posByRef.get(targetRef) : undefined);
  if (to === undefined) return 0;
  const origin = readProjectileOrigin(components);
  const arc = projectileArc(
    screen,
    tileToScreen(to.x / ONE, to.y / ONE),
    origin === null ? null : tileToScreen(origin.x / ONE, origin.y / ONE),
    readProjectileCover(components) === null ? 0 : COVER_LAUNCH_HEIGHT_PX,
  );
  item.rotation = arc.rotation;
  return arc.lift;
}

/**
 * Append the viewer's remembered statics (`data/fog/ghosts.ts`, pre-filtered to explored ground) to the
 * draw list: each projects with the same anchor/lift/depth formula as a live static (so a ghost occludes
 * correctly against live sprites at the fog boundary) but is tagged {@link DrawItem.ghost} for the pool's
 * grey tint. Every ghost ref joins `liveRefs` - a ghost of a dead entity keeps its pooled sprite alive as
 * long as the memory draws; a camera-culled ghost still counts as live but emits no item.
 */
export function pushGhostItems(
  items: MutableSpriteDrawItem[],
  liveRefs: Set<number>,
  ghosts: readonly FogGhost[],
  viewport: Viewport | undefined,
  elevation: ElevationField | undefined,
): void {
  for (const g of ghosts) {
    liveRefs.add(g.ref);
    const screen = tileToScreen(g.tileX, g.tileY);
    if (viewport !== undefined && !isVisible(viewport, screen.x, screen.y)) continue;
    const lift = terrainLiftAt(elevation, g.tileX, g.tileY);
    // Statics are always `idle`; the shared StaticDrawFields were frozen at capture.
    const item: MutableSpriteDrawItem = {
      kind: g.kind,
      ref: g.ref,
      x: screen.x,
      y: screen.y,
      depth: spriteDepth(g.tileX, g.tileY, g.kind),
      state: 'idle',
      ghost: true,
    };
    copyStaticFields(item, g);
    if (lift !== 0) item.lift = lift;
    items.push(item);
  }
}
