import type { WorldSnapshot } from '@open-northland/sim';
import type { FogGhost } from '../fog/index.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../projection/index.js';
import { type ElevationField, terrainLiftAt } from '../terrain/index.js';
import { spriteDepth } from './depth.js';
import type { MutableDrawItem, MutableSpriteDrawItem } from './draw-item.js';
import type { InHouseOverlay } from './in-house.js';
import { COVER_LAUNCH_HEIGHT_PX, projectileArc } from './projectile-arc.js';
import { SIGNPOST_BOARD_FRAMES, signpostBoardsOf } from './signpost-boards.js';
import {
  assignStaticFields,
  copyStaticFields,
  readAtomicElapsed,
  readAtomicRest,
  readBerryBushGfxIndex,
  readBerryBushLevel,
  readCarrying,
  readChestGfxIndex,
  readEngaged,
  readEquipmentArmorGood,
  readEquipmentWeaponGood,
  readFacing,
  readHpFraction,
  readJobType,
  readOwnerPlayer,
  readProducing,
  readProjectileAim,
  readProjectileCover,
  readProjectileOrigin,
  readSettlerTribe,
  readUpgradePct,
} from './snapshot-readers/index.js';

export function assignSettlerFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  actingAtomic: number | null,
  targetFacing: number | undefined,
): void {
  if (actingAtomic !== null) {
    item.atomicId = actingAtomic;
    if (readAtomicRest(components)) item.atomicRest = true;
    // The clock only rides with the atomic: a stale `CurrentAtomic` must not leave an orphan elapsed.
    const elapsed = readAtomicElapsed(components);
    if (elapsed !== null) item.elapsed = elapsed;
  }
  if (readEngaged(components)) item.engaged = true;
  // Target facing wins over the walk heading, so a stale path can't leave a mid-swing settler
  // chopping at empty air.
  const facing = targetFacing ?? readFacing(components);
  if (facing !== undefined) item.facing = facing;
  const carrying = readCarrying(components);
  if (carrying !== null) {
    item.carrying = true;
    if (carrying.goodType !== undefined) item.carryGood = carrying.goodType;
  }
  const jobType = readJobType(components);
  if (jobType !== undefined) item.jobType = jobType;
  const tribe = readSettlerTribe(components);
  if (tribe !== undefined) item.tribe = tribe;
  const weaponGood = readEquipmentWeaponGood(components);
  if (weaponGood !== undefined) item.weaponGood = weaponGood;
  const armorGood = readEquipmentArmorGood(components);
  if (armorGood !== undefined) item.armorGood = armorGood;
  const player = readOwnerPlayer(components);
  if (player !== undefined) item.player = player;
  // Only a born-young settler carries `Age`, which is what separates the age-class `jobType` ids 1..4
  // from colliding synthetic adult ids.
  if ('Age' in components) item.young = true;
}

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

/** A bush's `level` is 2 when fruited and 1 when bare; `gfxIndex` picks its species record. */
export function assignBerryBushFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
): void {
  const gfxIndex = readBerryBushGfxIndex(components);
  if (gfxIndex !== undefined) item.gfxIndex = gfxIndex;
  const level = readBerryBushLevel(components);
  if (level !== undefined) item.level = level;
}

/** A chest draws its own `[GfxLandscape]` record's one frame; `gfxIndex` also selects closed or open. */
export function assignChestFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
): void {
  const gfxIndex = readChestGfxIndex(components);
  if (gfxIndex !== undefined) item.gfxIndex = gfxIndex;
}

export function assignStockpileFields(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  isFlag: boolean,
): void {
  assignStaticFields(item, 'stockpile', components);
  if (isFlag) item.isFlag = true;
}

/**
 * The extra items one entity emits beside its own (a signpost's boards, the effects a craft stages) ride
 * synthetic negative refs, unique per (owner, slot) for a slot below this stride, so a pooled extra never
 * collides with a real entity id or with another owner's extras. Sized by the widest family, the boards.
 */
const EXTRA_ITEM_SLOTS = SIGNPOST_BOARD_FRAMES + 1;

export function extraItemRef(owner: number, slot: number): number {
  return -(owner * EXTRA_ITEM_SLOTS + slot + 1);
}

/**
 * Append one direction-board item per connected in-range neighbour, sharing the post's feet anchor.
 * Boards bypass the caller's shared push site, so their owner colour is mapped here.
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
    const boardRef = extraItemRef(item.ref, bucket);
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
 * Append the effects a worker's program stages this moment, each at its own offset from the workplace
 * anchor the worker itself is drawn against, and depth-sorted on that anchor like the worker. A program
 * beyond the ref stride's slots stages only the first ones; the extracted programs stage at most two.
 */
export function pushCraftFxItems(
  items: MutableSpriteDrawItem[],
  liveRefs: Set<number>,
  worker: MutableSpriteDrawItem,
  overlays: readonly InHouseOverlay[],
  house: { x: number; y: number },
  tileX: number,
  tileY: number,
): void {
  for (let slot = 0; slot < overlays.length && slot < EXTRA_ITEM_SLOTS; slot++) {
    const overlay = overlays[slot];
    if (overlay === undefined) continue;
    const ref = extraItemRef(worker.ref, slot);
    liveRefs.add(ref);
    const fx: MutableSpriteDrawItem = {
      kind: 'craftfx',
      ref,
      x: house.x + overlay.dx,
      y: house.y + overlay.dy,
      depth: spriteDepth(tileX, tileY, 'craftfx'),
      state: 'idle',
      fxName: overlay.name,
    };
    if (worker.lift !== undefined) fx.lift = worker.lift;
    items.push(fx);
  }
}

/** Append persistent effects anchored to a building. They reuse the same looping landscape-effect kind
 * as in-house craft overlays, but their synthetic refs belong to the building itself. */
export function pushBuildingFxItems(
  items: MutableSpriteDrawItem[],
  liveRefs: Set<number>,
  building: MutableSpriteDrawItem,
  overlays: readonly InHouseOverlay[],
  tileX: number,
  tileY: number,
): void {
  for (let slot = 0; slot < overlays.length && slot < EXTRA_ITEM_SLOTS; slot++) {
    const overlay = overlays[slot];
    if (overlay === undefined) continue;
    const ref = extraItemRef(building.ref, slot);
    liveRefs.add(ref);
    const fx: MutableSpriteDrawItem = {
      kind: 'craftfx',
      ref,
      x: building.x + overlay.dx,
      y: building.y + overlay.dy,
      depth: spriteDepth(tileX, tileY, 'craftfx'),
      state: 'idle',
      fxName: overlay.name,
    };
    if (building.lift !== undefined) fx.lift = building.lift;
    items.push(fx);
  }
}

/**
 * Put a projectile on its stable projected release chord, point it along the arc, and return its
 * ballistic height in screen px.
 */
export function assignProjectileArc(
  item: MutableDrawItem,
  components: Readonly<Record<string, unknown>>,
  current: { x: number; y: number },
): number {
  const to = readProjectileAim(components);
  if (to === null) return 0;
  const origin = readProjectileOrigin(components);
  const arc = projectileArc(
    current,
    { x: to.x / ONE, y: to.y / ONE },
    origin === null ? null : { x: origin.x / ONE, y: origin.y / ONE },
    readProjectileCover(components) === null ? 0 : COVER_LAUNCH_HEIGHT_PX,
  );
  item.x = arc.x;
  item.y = arc.y;
  item.rotation = arc.rotation;
  return arc.lift;
}

/**
 * Append the viewer's remembered statics, each projected with the same anchor, lift and depth formula
 * as a live static so it occludes correctly at the fog boundary. A ghost joins `liveRefs` before the
 * cull, so a dead entity keeps its pooled sprite for as long as the memory draws.
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
