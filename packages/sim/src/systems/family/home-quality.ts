import type {
  BuildingType,
  ContentSet,
  GoodType,
  HomeQualityEffect,
  HomeQualityUse,
} from '@open-northland/data';
import {
  Building,
  DEFAULT_HOUSEHOLD_GOOD_POLICY,
  HomeQuality,
  HouseholdGoodPolicy,
  ownerOf,
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
  lodging: 0,
  piety: 0,
};

/** A ware that spends one `useCost` per household action: crockery, holy oil. */
type ActionHomeQuality = Exclude<HomeQualityUse, { readonly effect: 'lodging' }>;
/** The ware that houses extra families and wears by activity: furniture. */
export type LodgingHomeQuality = Extract<HomeQualityUse, { readonly effect: 'lodging' }>;

export function homeQualityUse(ctx: ContentContext, goodType: number): HomeQualityUse | undefined {
  return contentIndex(ctx.content).goods.get(goodType)?.homeQuality;
}

/** The goods configured as household wares, in content order. */
type HouseholdWare = GoodType & { readonly homeQuality: HomeQualityUse };
const householdWares = new WeakMap<ContentSet, readonly HouseholdWare[]>();

function householdWaresOf(content: ContentSet): readonly HouseholdWare[] {
  let wares = householdWares.get(content);
  if (wares === undefined) {
    wares = content.goods.filter((good): good is HouseholdWare => good.homeQuality !== undefined);
    householdWares.set(content, wares);
  }
  return wares;
}

/** The first configured ware serving `effect`, in content order. */
export function homeQualityUseFor(
  ctx: ContentContext,
  effect: HomeQualityEffect,
): HomeQualityUse | undefined {
  for (const good of householdWaresOf(ctx.content))
    if (good.homeQuality.effect === effect) return good.homeQuality;
  return undefined;
}

/** The per-action ware serving `effect`, first in content order. */
export function actionHomeQualityFor(
  ctx: ContentContext,
  effect: ActionHomeQuality['effect'],
): ActionHomeQuality | undefined {
  const use = homeQualityUseFor(ctx, effect);
  return use?.effect === 'lodging' ? undefined : use;
}

/** The ware serving lodging, first in content order. */
export function lodgingUseFor(ctx: ContentContext): LodgingHomeQuality | undefined {
  const use = homeQualityUseFor(ctx, 'lodging');
  return use?.effect === 'lodging' ? use : undefined;
}

export function homeQualityValue(world: World, home: Entity, effect: HomeQualityEffect): number {
  return world.tryGet(home, HomeQuality)?.[effect] ?? 0;
}

export function homeQualityAllowed(world: World, home: Entity, effect: HomeQualityEffect): boolean {
  const owner = ownerOf(world, home);
  return owner === undefined || householdGoodAllowed(world, owner, effect);
}

/** Whether `player`'s settlement-wide policy currently allows `effect`. */
export function householdGoodAllowed(world: World, player: number, effect: HomeQualityEffect): boolean {
  const carrier = householdGoodPolicyEntity(world, player);
  return (carrier === null ? DEFAULT_HOUSEHOLD_GOOD_POLICY : world.get(carrier, HouseholdGoodPolicy))[effect];
}

function householdGoodPolicyEntity(world: World, player: number): Entity | null {
  let best: Entity | null = null;
  for (const e of world.query(HouseholdGoodPolicy)) {
    if (world.get(e, HouseholdGoodPolicy).player !== player) continue;
    if (best === null || e < best) best = e;
  }
  return best;
}

/** Whether a finished home may currently use this quality role. The policy pauses the use of stored
 *  crockery and furniture; stored holy oil serves whatever it says. */
export function homeQualityActive(
  world: World,
  ctx: ContentContext,
  home: Entity,
  effect: HomeQualityEffect,
): boolean {
  if (homeQualityValue(world, home, effect) <= 0) return false;
  const policy = homeQualityUseFor(ctx, effect);
  const building = world.tryGet(home, Building);
  if (policy === undefined || building === undefined || building.built < ONE) return false;
  const type = contentIndex(ctx.content).buildings.get(building.buildingType);
  return (
    type?.kind === 'home' &&
    building.level >= policy.minimumHomeLevel &&
    (effect === 'piety' || homeQualityAllowed(world, home, effect))
  );
}

/**
 * How many families `home`, a home of `type`, takes now: its `homeSize`, plus its `furnishedFamilies` while
 * it holds furniture its owner allows ({@link homeQualityActive}). Owner's design: furniture houses extra
 * families instead of improving rest.
 */
export function homeFamilyCapacity(
  world: World,
  ctx: ContentContext,
  home: Entity,
  type: BuildingType,
): number {
  return type.furnishedFamilies > 0 && homeQualityActive(world, ctx, home, 'lodging')
    ? type.homeSize + type.furnishedFamilies
    : type.homeSize;
}

/** Spend one use when the pool can pay it in full. A sub-cost remainder stays available, as in the
 * original house-quality fields. */
export function spendHomeQuality(
  world: World,
  home: Entity,
  effect: HomeQualityEffect,
  amount: number,
): boolean {
  if (effect !== 'piety' && !homeQualityAllowed(world, home, effect)) return false;
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
      lodging: use.effect === 'lodging' ? Math.min(use.capacity, moved * use.deliveryValue) : 0,
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
  let out: Set<number> | undefined;
  for (const good of householdWaresOf(ctx.content)) {
    const use = good.homeQuality;
    if (
      !homeQualityAllowed(world, home, use.effect) ||
      homeQualityValue(world, home, use.effect) >= use.fetchBelow
    )
      continue;
    // Oil starts serving the mature home. The source field is only structurally identified as house
    // level, so the threshold is content-owned beside the rest of the policy.
    if (level < use.minimumHomeLevel) continue;
    if (!goodEnabled(world, ctx, owner, identity.tribe, good.typeId)) continue;
    out ??= new Set<number>();
    out.add(good.typeId);
  }
  return out ?? EMPTY_GOODS;
}

const EMPTY_GOODS: ReadonlySet<number> = new Set<number>();

/**
 * Toggle one player's settlement-wide policy, including homes built later. Oil permission controls
 * deliveries only; stored oil keeps burning and serving prayer. Other furnishings pause their uses, and
 * paused furniture houses no extra families (the command moves them out, `lodging.ts`).
 */
export function setHouseholdGoodUse(
  world: World,
  ctx: SystemContext,
  command: { readonly player: number; readonly effect: HomeQualityEffect; readonly allowed: boolean },
): void {
  const policy = homeQualityUseFor(ctx, command.effect);
  if (policy === undefined) return;

  const carrier = householdGoodPolicyEntity(world, command.player);
  const current = carrier === null ? DEFAULT_HOUSEHOLD_GOOD_POLICY : world.get(carrier, HouseholdGoodPolicy);
  if (current[command.effect] === command.allowed) return;
  const next = {
    player: command.player,
    cooking: current.cooking,
    lodging: current.lodging,
    piety: current.piety,
    [command.effect]: command.allowed,
  };
  const isDefault =
    next.cooking === DEFAULT_HOUSEHOLD_GOOD_POLICY.cooking &&
    next.lodging === DEFAULT_HOUSEHOLD_GOOD_POLICY.lodging &&
    next.piety === DEFAULT_HOUSEHOLD_GOOD_POLICY.piety;
  if (isDefault) {
    if (carrier !== null) world.destroy(carrier);
  } else if (carrier === null) world.add(world.create(), HouseholdGoodPolicy, next);
  else Object.assign(world.mut(carrier, HouseholdGoodPolicy), next);
}

/** Burn to zero once per game second, including damaged homes. Deliberate rule: a partial last
 * payment extinguishes the fire instead of preserving an indefinitely usable remainder. */
export function drainHolyOil(world: World, ctx: SystemContext): void {
  if (ctx.tick % TICKS_PER_SECOND !== 0) return;
  const oil = actionHomeQualityFor(ctx, 'piety');
  if (oil === undefined) return;
  for (const home of world.query(HomeQuality, Building)) {
    if (!homeQualityActive(world, ctx, home, 'piety')) continue;
    spendHomeQuality(world, home, 'piety', Math.min(oil.useCost, homeQualityValue(world, home, 'piety')));
  }
}
