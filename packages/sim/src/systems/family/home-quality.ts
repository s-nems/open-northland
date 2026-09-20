import type { HomeQualityEffect, HomeQualityUse } from '@open-northland/data';
import {
  Building,
  HomeQuality,
  HomeQualityPolicy,
  ownerOf,
  Residence,
  Settler,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext, SystemContext } from '../context.js';
import { goodEnabled } from '../progression/availability.js';

const EMPTY_QUALITY: Readonly<Record<HomeQualityEffect, number>> = {
  cooking: 0,
  rest: 0,
  piety: 0,
};

export function homeQualityUse(ctx: ContentContext, goodType: number): HomeQualityUse | undefined {
  return contentIndex(ctx.content).goods.get(goodType)?.homeQuality;
}

/** The first configured ware serving `effect`, in content order. */
export function homeQualityUseFor(
  ctx: ContentContext,
  effect: HomeQualityEffect,
): HomeQualityUse | undefined {
  for (const good of ctx.content.goods) if (good.homeQuality?.effect === effect) return good.homeQuality;
  return undefined;
}

export function homeQualityValue(world: World, home: Entity, effect: HomeQualityEffect): number {
  return world.tryGet(home, HomeQuality)?.[effect] ?? 0;
}

export function homeQualityAllowed(world: World, home: Entity, effect: HomeQualityEffect): boolean {
  return world.tryGet(home, HomeQualityPolicy)?.[effect] ?? true;
}

/** Whether a finished home may currently use this quality role. */
export function homeQualityActive(
  world: World,
  ctx: ContentContext,
  home: Entity,
  effect: HomeQualityEffect,
): boolean {
  const policy = homeQualityUseFor(ctx, effect);
  const building = world.tryGet(home, Building);
  if (policy === undefined || building === undefined || building.built < ONE) return false;
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  return (
    type?.kind === 'home' &&
    building.level >= policy.minimumHomeLevel &&
    homeQualityAllowed(world, home, effect) &&
    homeQualityValue(world, home, effect) > 0
  );
}

/** Spend one use when the pool can pay it in full. A sub-cost remainder stays available, as in the
 * original house-quality fields. */
export function spendHomeQuality(
  world: World,
  home: Entity,
  effect: HomeQualityEffect,
  amount: number,
): boolean {
  if (!homeQualityAllowed(world, home, effect)) return false;
  const quality = world.tryGet(home, HomeQuality);
  if (quality === undefined || quality[effect] < amount) return false;
  world.mut(home, HomeQuality)[effect] -= amount;
  return true;
}

/** Deposit one carried household good into a residence's durable quality pool. */
export function depositHomeQuality(
  world: World,
  ctx: SystemContext,
  home: Entity,
  goodType: number,
  amount: number,
): number {
  const building = world.tryGet(home, Building);
  if (building === undefined || amount <= 0) return 0;
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  const use = homeQualityUse(ctx, goodType);
  if (
    type?.kind !== 'home' ||
    use === undefined ||
    building.level < use.minimumHomeLevel ||
    !homeQualityAllowed(world, home, use.effect)
  )
    return 0;

  const existing = world.tryGet(home, HomeQuality) ?? EMPTY_QUALITY;
  if (existing[use.effect] >= use.capacity) return 0;
  const moved = Math.min(amount, Math.ceil((use.capacity - existing[use.effect]) / use.deliveryValue));
  if (moved <= 0) return 0;
  const quality = world.tryMut(home, HomeQuality);
  if (quality === undefined) {
    world.add(home, HomeQuality, {
      cooking: use.effect === 'cooking' ? Math.min(use.capacity, moved * use.deliveryValue) : 0,
      rest: use.effect === 'rest' ? Math.min(use.capacity, moved * use.deliveryValue) : 0,
      piety: use.effect === 'piety' ? Math.min(use.capacity, moved * use.deliveryValue) : 0,
    });
  } else {
    quality[use.effect] = Math.min(use.capacity, quality[use.effect] + moved * use.deliveryValue);
  }
  return moved;
}

/** Configured household goods this resident may fetch while its home's pool is below its demand target. */
export function demandedHomeQualityGoods(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  home: Entity,
): ReadonlySet<number> {
  const identity = world.tryGet(settler, Settler);
  if (identity === undefined) return EMPTY_GOODS;
  const owner = ownerOf(world, settler);
  const level = world.tryGet(home, Building)?.level ?? 0;
  const out = new Set<number>();
  for (const good of ctx.content.goods) {
    const use = good.homeQuality;
    if (
      use === undefined ||
      !homeQualityAllowed(world, home, use.effect) ||
      homeQualityValue(world, home, use.effect) >= use.fetchBelow
    )
      continue;
    // Oil starts serving the mature home. The source field is only structurally identified as house
    // level, so the threshold is content-owned beside the rest of the policy.
    if (level < use.minimumHomeLevel) continue;
    if (!goodEnabled(world, ctx, owner, identity.tribe, good.typeId)) continue;
    out.add(good.typeId);
  }
  return out;
}

/** The home currently containing `settler`, if it is its own residence. */
export function occupiedHome(world: World, settler: Entity): Entity | null {
  const home = world.tryGet(settler, Residence)?.home;
  return home !== undefined && world.isAlive(home) ? home : null;
}

const EMPTY_GOODS: ReadonlySet<number> = new Set<number>();

/**
 * Toggle one finished home's use policy. The original flag blocks demand and delivery only; the player-facing
 * control intentionally also pauses consumption and effects while preserving the stored pool.
 */
export function setHomeQualityUse(
  world: World,
  ctx: SystemContext,
  command: { readonly home: Entity; readonly effect: HomeQualityEffect; readonly allowed: boolean },
): void {
  const building = world.tryGet(command.home, Building);
  if (building === undefined || building.built < ONE) return;
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  const policy = homeQualityUseFor(ctx, command.effect);
  if (type?.kind !== 'home' || policy === undefined || building.level < policy.minimumHomeLevel) return;

  const current = world.tryGet(command.home, HomeQualityPolicy) ?? DEFAULT_POLICY;
  if (current[command.effect] === command.allowed) return;
  const next = { ...current, [command.effect]: command.allowed };
  if (next.cooking && next.rest && next.piety) world.remove(command.home, HomeQualityPolicy);
  else world.add(command.home, HomeQualityPolicy, next);
}

const DEFAULT_POLICY: Readonly<Record<HomeQualityEffect, boolean>> = {
  cooking: true,
  rest: true,
  piety: true,
};

/** Burn the sacred fire once per game second in every eligible finished home. A remainder smaller than
 * one use stays in the pool, matching an original routine. */
export function drainHolyOil(world: World, ctx: SystemContext): void {
  if (ctx.tick % TICKS_PER_SECOND !== 0) return;
  const oil = homeQualityUseFor(ctx, 'piety');
  if (oil === undefined) return;
  for (const home of world.query(HomeQuality, Building)) {
    if (!homeQualityActive(world, ctx, home, 'piety')) continue;
    spendHomeQuality(world, home, 'piety', oil.useCost);
  }
}
