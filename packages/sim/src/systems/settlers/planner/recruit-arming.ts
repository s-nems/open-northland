import type { ContentSet, WeaponType } from '@open-northland/data';
import {
  Age,
  AssistantRecruit,
  Building,
  Carrying,
  Equipment,
  EquipOrder,
  ownerOf,
  ownersCompatible,
  Position,
  Settler,
  type SettlerIdentity,
  Stockpile,
  SupplyRun,
  TrainingOrder,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingBlockedCells } from '../../footprint/index.js';
import {
  ARMOR_MAIN_TYPE,
  armorByClass,
  isSoldierJob,
  weaponDamageVsMaterial,
} from '../../readviews/index.js';
import { type NavigationLimit, networkLimitAt } from '../../signposts/index.js';
import { canonicalById, entityNode } from '../../spatial/nodes.js';
import { INTENT_WEAPON_CLASS } from '../atomics/effects/goods/weapon-class.js';
import {
  interactionCell,
  nearestStoreHolding,
  storeYieldsGood,
  type TargetCandidates,
} from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import { ASSISTANT_SCAN_PERIOD_TICKS } from './assistant-grants.js';
import type { PlannerPass } from './pass.js';
import { anotherSystemOwns } from './replan.js';

/**
 * The assistant's arming pass: dress each enlisted weapon-class recruit (`AssistantRecruit`, drill
 * served) from any reachable store in ONE outing - the weapon first (the good→class transform lands
 * in the equip effect, which also pays the counter), then the equip drive chains the armor want at
 * the store via {@link chainRecruitArmor} before the single walk home (user rule: no
 * second trip). Weapon preference is the strongest reachable row of {@link armingGoodPreference};
 * armor comes from {@link pickReachableArmor}. Runs on the grants pass's stride beat with the same
 * one-errand rule.
 */
export function dispatchRecruitArming(pass: PlannerPass): void {
  const { world, ctx } = pass;
  const recruits = canonicalById(world.query(AssistantRecruit));
  if (recruits.length === 0) return; // no bookings: the pass costs one empty query

  for (const e of recruits) {
    if ((e + ctx.tick) % ASSISTANT_SCAN_PERIOD_TICKS !== 0) continue;
    const booking = world.get(e, AssistantRecruit);
    if (booking.intent === 'trainSoldiers') continue; // never armed (enlist unmarks; a beat may race it)
    if (world.has(e, TrainingOrder)) continue; // still drilling
    const settler = world.get(e, Settler);
    if (!isSoldierJob(ctx.content, settler.jobType)) continue; // fell out - the assistant sweep drops it
    if (world.has(e, EquipOrder) || world.has(e, Age) || anotherSystemOwns(world, e)) continue;
    if (world.has(e, Carrying) || world.has(e, SupplyRun)) continue;
    const owner = ownerOf(world, e);
    if (owner === undefined) continue;

    const eq = world.tryGet(e, Equipment);
    if (!booking.armed) {
      // Weapon leg. A worn weapon with the booking still unarmed means the good landed OUTSIDE the
      // take-up transform (worn before the draft, or a class-less/unearned manual equip whose
      // take-up released and something re-marked) - the slot this booking would fill is taken, so
      // release it and let the counter book someone else instead of skipping forever.
      if ((eq?.weapon ?? null) !== null) {
        world.remove(e, AssistantRecruit);
        continue;
      }
      dispatchWeaponFetch(pass, e, settler, booking.intent, owner);
      continue;
    }
    // Armor leg, the FALLBACK outing: the weapon errand normally chains the armor at the store, so
    // this only re-dispatches a recruit whose chained errand was lost (a drop, an override) armed
    // but bare. One worn armor completes the recruit; nothing in store releases it unarmored.
    if ((eq?.armor ?? null) !== null) {
      world.remove(e, AssistantRecruit);
      continue;
    }
    if (!dispatchArmorFetch(pass, e, owner)) world.remove(e, AssistantRecruit);
  }
}

/**
 * The good types an `intent` recruit may be armed with, strongest first: bare-target damage decides
 * (a long bow outranks a short one) and the good id only breaks a tie. A row needs both a class
 * (`jobtype`) and a craftable good (`goodtype`) to arm anyone.
 */
export function armingGoodPreference(
  content: ContentSet,
  tribe: number,
  intent: keyof typeof INTENT_WEAPON_CLASS,
): readonly number[] {
  const mainType = INTENT_WEAPON_CLASS[intent];
  const rows = content.weapons.filter(
    (w): w is WeaponType & { goodType: number } =>
      w.tribeType === tribe && w.mainType === mainType && w.goodType !== undefined && w.jobType !== undefined,
  );
  rows.sort(
    (a, b) =>
      weaponDamageVsMaterial(b, BARE_TARGET) - weaponDamageVsMaterial(a, BARE_TARGET) ||
      a.goodType - b.goodType,
  );
  return [...new Set(rows.map((w) => w.goodType))];
}

/**
 * Whether the seat could arm a `tribe` recruit of this `intent` right now: some store inside `reach` holds
 * a good {@link armingGoodPreference} would shop for. The prediction the garrison rung sizes its standing
 * order with, kept beside the pass that has to fulfil it so the two cannot drift - same goods, same store
 * rule ({@link storeYieldsGood}), same reach {@link fetchRouteFor} searches under. Existence only: which
 * recruit walks there is the dispatch's problem. Ownership follows the pass's rule ({@link
 * ownersCompatible}), so a neutral ground heap of swords counts like a stocked warehouse.
 */
export function canArmRecruit(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  tribe: number,
  intent: keyof typeof INTENT_WEAPON_CLASS,
  reach: NavigationLimit | null,
): boolean {
  const goods = armingGoodPreference(ctx.content, tribe, intent);
  if (goods.length === 0) return false; // the tribe's data binds no such class
  const walls = buildingBlockedCells(world, ctx, terrain);
  for (const store of world.query(Stockpile)) {
    if (!ownersCompatible(player, ownerOf(world, store))) continue;
    if (!goods.some((good) => storeYieldsGood(world, ctx, terrain, walls, store, good))) continue;
    if (reach === null || reach.allowsNode(approachNode(world, ctx, terrain, store))) return true;
  }
  return false;
}

/** Where a fetcher stands to draw on a store - a building at its door, a ground pile at its own node. */
function approachNode(world: World, ctx: SystemContext, terrain: TerrainGraph, store: Entity): NodeId {
  return world.has(store, Building)
    ? interactionCell(world, ctx, terrain, store)
    : entityNode(world, terrain, store);
}

/** Send the recruit for the strongest reachable weapon of its intent's class it qualifies for. */
function dispatchWeaponFetch(
  pass: PlannerPass,
  e: Entity,
  settler: SettlerIdentity,
  intent: keyof typeof INTENT_WEAPON_CLASS,
  owner: number,
): void {
  const { world, ctx, terrain, targets } = pass;
  let route: FetchRoute | undefined;
  for (const goodType of armingGoodPreference(ctx.content, settler.tribe, intent)) {
    route ??= fetchRouteFor(pass, e, owner);
    const src = nearestStoreHolding(
      targets.stockpileCells,
      world,
      ctx,
      terrain,
      route.here,
      goodType,
      owner,
      route.limit ?? undefined,
      route.veto,
    );
    if (src === null) continue; // nothing reachable holds this row - the weaker one may still be
    world.add(e, EquipOrder, {
      group: 'weapon',
      slot: 0,
      goodType,
      returnTo: route.here,
      stage: 'acquire',
      issuer: 'assistant',
    });
    return;
  }
}

/**
 * Send the armed recruit for one {@link pickReachableArmor} good. True when an errand was
 * dispatched, false when no tier has a reachable unit (the caller releases the recruit unarmored).
 */
function dispatchArmorFetch(pass: PlannerPass, e: Entity, owner: number): boolean {
  const { world, ctx, terrain, targets } = pass;
  const route = fetchRouteFor(pass, e, owner);
  const pick = pickReachableArmor(world, ctx, terrain, targets, route.here, owner, route.limit, route.veto);
  if (pick === null) return false;
  world.add(e, EquipOrder, {
    group: 'armor',
    slot: 0,
    goodType: pick,
    returnTo: route.here,
    stage: 'acquire',
    issuer: 'assistant',
  });
  return true;
}

/**
 * The equip drive's chain hook (the one-outing rule): the moment an assistant weapon errand lands
 * its weapon, ask for the armor want from RIGHT THERE instead of walking home first. Returns the
 * armor goodType to retarget the live order at, or null to walk home - a dressed recruit or one
 * with no tier reachable has its booking settled here, exactly as the fallback armor leg would.
 *
 * Searched from the network around the store he stands at, not the drive's own gate ({@link FetchRoute}).
 */
export function chainRecruitArmor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
  e: Entity,
  here: NodeId,
  veto: ((cell: NodeId) => boolean) | undefined,
): number | null {
  const booking = world.tryGet(e, AssistantRecruit);
  if (booking === undefined || !booking.armed) return null;
  const owner = ownerOf(world, e);
  if (owner === undefined) return null;
  if ((world.tryGet(e, Equipment)?.armor ?? null) !== null) {
    world.remove(e, AssistantRecruit); // already dressed - the booking is complete
    return null;
  }
  const limit = networkLimitAt(world, terrain, owner, terrain.xOf(here), terrain.yOf(here));
  const pick = pickReachableArmor(world, ctx, terrain, targets, here, owner, limit, veto);
  if (pick === null) {
    world.remove(e, AssistantRecruit); // no tier reachable: released unarmored
    return null;
  }
  return pick;
}

/** The armor policy's one home: a seeded-random reachable good from the heavy tier, the light tier
 *  as the fallback, null when no tier has a reachable unit - the spec's "if available", so a recruit
 *  may complete unarmored. */
function pickReachableArmor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
  here: NodeId,
  owner: number,
  limit: NavigationLimit | null,
  veto: ((cell: NodeId) => boolean) | undefined,
): number | null {
  const byClass = armorByClass(ctx.content);
  for (const tier of [ARMOR_MAIN_TYPE.HEAVY, ARMOR_MAIN_TYPE.LIGHT]) {
    const sources: number[] = [];
    for (const armor of byClass.get(tier) ?? []) {
      if (armor.goodType === undefined) continue;
      const src = nearestStoreHolding(
        targets.stockpileCells,
        world,
        ctx,
        terrain,
        here,
        armor.goodType,
        owner,
        limit ?? undefined,
        veto,
      );
      if (src !== null) sources.push(armor.goodType);
    }
    if (sources.length === 0) continue;
    const pick = sources[ctx.rng.int(sources.length)];
    if (pick !== undefined) return pick;
  }
  return null;
}

/** The unarmored damage column (`damagevalue 0`) - the strength axis the weapon preference sorts on. */
const BARE_TARGET = 0;

/** The recruit's store-search inputs, resolved once per dispatch attempt. `limit` is the settlement
 *  network at his feet, not his own confinement - `settlers/drives/equip-order.ts` owns that rule and
 *  re-applies it to every step of the walk. */
interface FetchRoute {
  readonly here: NodeId;
  readonly limit: NavigationLimit | null;
  readonly veto: ((cell: NodeId) => boolean) | undefined;
}

function fetchRouteFor(pass: PlannerPass, e: Entity, owner: number): FetchRoute {
  const { world, ctx, terrain } = pass;
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return {
    here: terrain.nodeAtClamped(n.hx, n.hy),
    limit: networkLimitAt(world, terrain, owner, n.hx, n.hy),
    veto: unreachableGoalVeto(world, ctx, e),
  };
}
