import type { ContentSet, WeaponType } from '@open-northland/data';
import {
  Age,
  type AssistantArmingIntent,
  AssistantRecruit,
  AssistantWeaponVetoes,
  assistantArmorOrder,
  assistantWeaponOrder,
  Building,
  Carrying,
  Equipment,
  EquipOrder,
  ownerOf,
  ownersCompatible,
  PickupClaim,
  Position,
  playerGoodList,
  Settler,
  type SettlerIdentity,
  SupplyRun,
  sameSide,
  TrainingOrder,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { SpatialGate } from '../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingBlockedCells } from '../../footprint/index.js';
import { isTravelling } from '../../movement/nav-state.js';
import {
  armorGoodsByProtection,
  isBarracks,
  isBarracksOrFoundation,
  isSoldierJob,
  weaponDamageVsMaterial,
  weaponGoodsByStrength,
} from '../../readviews/index.js';
import type { NavigationLimit } from '../../signposts/index.js';
import { goodsSearchLimitAt } from '../../signposts/reach.js';
import { entityNode } from '../../spatial/nodes.js';
import { mayFetchGoodFrom, type SupplyTally } from '../../stores/index.js';
import { anotherSystemOwns } from '../action-owner.js';
import { EQUIP_FETCH_UNITS, equipFromStore } from '../atomics/effects/goods/index.js';
import { INTENT_WEAPON_CLASS } from '../atomics/effects/goods/weapon-class.js';
import {
  FetchableStock,
  interactionCell,
  nearestStoreHolding,
  nearestStoreHoldingWithin,
  storeHoldingMayLieIn,
  storeYieldsGood,
  type TargetCandidates,
  unclaimedStockOf,
} from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import { ASSISTANT_SCAN_PERIOD_TICKS } from './assistant-grants.js';
import { wakeIdle } from './idle-replan.js';
import type { PlannerPass } from './pass.js';

/**
 * The assistant's arming pass: dress each enlisted weapon-class recruit, a drilled one or a bare-handed
 * soldier its counter booked, from any reachable store. Authored: one outing, so the weapon is fetched
 * first and the equip drive chains the armor want at the store before the single walk back to the
 * recruit's barracks (owner's ruling: armed soldiers gather there, not at the store). Runs on the grants
 * pass's stride beat with the same one-errand rule. A dispatch claims its unit at once, so a recruit on the same beat shops for
 * another; the recruit's own plan re-claims it.
 */
export function dispatchRecruitArming(pass: PlannerPass): void {
  const { world, ctx } = pass;
  const recruits = world.canonicalQuery(AssistantRecruit);
  if (recruits.length === 0) return; // no bookings: the pass costs one empty query

  for (const e of recruits) {
    if ((e + ctx.tick) % ASSISTANT_SCAN_PERIOD_TICKS !== 0) continue;
    const booking = world.get(e, AssistantRecruit);
    if (booking.intent === 'trainSoldiers') continue; // never armed (enlist unmarks; a beat may race it)
    if (world.has(e, TrainingOrder)) continue; // still drilling
    const settler = world.get(e, Settler);
    if (!isSoldierJob(ctx.content, settler.jobType)) continue; // fell out - the assistant sweep drops it
    if (world.has(e, EquipOrder) || world.has(e, Age) || anotherSystemOwns(world, e)) continue;
    // A recruit with its hands or its walk spoken for is left to finish: a dispatch now would restamp the
    // claim it holds onto the weapon while it keeps walking elsewhere.
    if (
      world.has(e, Carrying) ||
      world.has(e, SupplyRun) ||
      world.has(e, PickupClaim) ||
      isTravelling(world, e)
    )
      continue;
    const owner = ownerOf(world, e);
    if (owner === undefined) continue;

    const eq = world.tryGet(e, Equipment);
    if (!booking.armed) {
      // A worn weapon with the booking still unarmed means the good landed outside the take-up
      // transform, so the slot this booking would fill is taken: release it and let the counter book
      // someone else instead of skipping forever.
      if ((eq?.weapon ?? null) !== null) {
        world.remove(e, AssistantRecruit);
        continue;
      }
      dispatchWeaponFetch(pass, e, settler, booking.intent, booking.barracks, owner);
      continue;
    }
    // The fallback armor outing: the weapon errand normally chains the armor at the store, so this
    // only re-dispatches a recruit left armed but bare when that chained errand was lost.
    if ((eq?.armor ?? null) !== null) {
      world.remove(e, AssistantRecruit);
      continue;
    }
    if (!dispatchArmorFetch(pass, e, booking.intent, booking.barracks, owner)) {
      world.remove(e, AssistantRecruit);
    }
  }
}

/**
 * The good types an `intent` recruit may be armed with, strongest first: bare-target damage decides and
 * the good id only breaks a tie. A row needs both a `jobtype` and a `goodtype` to arm anyone, and a
 * `vetoed` good (the seat's {@link AssistantWeaponVetoes}) arms nobody. The list is shared: read it, never
 * edit it.
 */
export function armingGoodPreference(
  content: ContentSet,
  tribe: number,
  intent: keyof typeof INTENT_WEAPON_CLASS,
  vetoed: readonly number[],
): readonly number[] {
  const all = unvetoedPreference(content, tribe, intent);
  for (const good of all) {
    if (vetoed.includes(good)) return all.filter((kept) => !vetoed.includes(kept));
  }
  return all;
}

/** {@link armingGoodPreference} before any veto, per content, tribe and intent: content-static. */
const preferenceTables = new WeakMap<ContentSet, Map<number, Map<string, readonly number[]>>>();

function unvetoedPreference(
  content: ContentSet,
  tribe: number,
  intent: keyof typeof INTENT_WEAPON_CLASS,
): readonly number[] {
  let byTribe = preferenceTables.get(content);
  if (byTribe === undefined) {
    byTribe = new Map();
    preferenceTables.set(content, byTribe);
  }
  let byIntent = byTribe.get(tribe);
  if (byIntent === undefined) {
    byIntent = new Map();
    byTribe.set(tribe, byIntent);
  }
  const held = byIntent.get(intent);
  if (held !== undefined) return held;
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
  const goods = [...new Set(rows.map((w) => w.goodType))];
  byIntent.set(intent, goods);
  return goods;
}

/**
 * Which of `intents` the seat could arm a `tribe` recruit for right now: those some store inside
 * `reach` holds a good {@link armingGoodPreference} would shop for, returned in the caller's order.
 * The garrison rung sizes its standing order with this, so it applies the same goods, store rule,
 * reach and ownership rule as the dispatch below, and a neutral ground heap of swords counts like a
 * stocked warehouse. Existence only: which recruit walks there is the dispatch's problem. Only the
 * stores the {@link FetchableStock} ledger lists as lending a wanted good are read, a superset of those
 * {@link storeYieldsGood} accepts, so the cost is the weapon holders, not every heap on the map.
 * `vetoed` is the seat's veto list as the caller will have it, which may run ahead of the stored one.
 */
export function armableIntents<Intent extends keyof typeof INTENT_WEAPON_CLASS>(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  tribe: number,
  intents: readonly Intent[],
  reach: NavigationLimit | null,
  vetoed: readonly number[],
): readonly Intent[] {
  const stock = reachableStock(world, ctx, terrain, player, reach);
  // An intent whose tribe data binds no craftable class row can never be armed: its goods are empty.
  return intents.filter((intent) =>
    armingGoodPreference(ctx.content, tribe, intent, vetoed).some((good) => stock.holds(good)),
  );
}

/** The stock an errand on `player`'s side can draw on inside one reach ({@link reachableStock}). */
export interface ReachableStock {
  /** Whether some store lends a unit of `good`. */
  holds(good: number): boolean;
  /** The units of `good` the stores lend, each store's storage minimum held back. */
  units(good: number): number;
}

/**
 * The stock inside `reach` (null: anywhere) that `player`'s arming and dressing errands can fetch: the
 * stores the {@link FetchableStock} ledger lists that {@link storeYieldsGood} accepts, the side's own or
 * nobody's, a standing place inside the reach. The seat stock ledger also counts goods in a carrier's
 * hands, goods kept aside for an upgrade and heaps past the network, none of which an errand reaches, so a
 * seat sizing its draft or its vetoes on it books recruits who wait unarmed beside a vetoed weapon.
 * Each good's units are counted once, so read the stock within one state of the world.
 */
export function reachableStock(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  reach: NavigationLimit | null,
): ReachableStock {
  const ledger = FetchableStock.of(world, ctx);
  let walls: ReadonlySet<NodeId> | undefined;
  const reachedStores = new Map<Entity, boolean>();
  const unitsByGood = new Map<number, number>();
  const reached = (store: Entity): boolean => {
    if (reach === null) return true;
    let known = reachedStores.get(store);
    if (known === undefined) {
      known = reach.allowsNode(approachNode(world, ctx, terrain, store));
      reachedStores.set(store, known);
    }
    return known;
  };
  const lends = (store: Entity, good: number): boolean => {
    if (!ownersCompatible(player, ownerOf(world, store))) return false;
    walls ??= buildingBlockedCells(world, ctx, terrain);
    return storeYieldsGood(world, ctx, terrain, walls, store, good) && reached(store);
  };
  return {
    holds: (good) => {
      for (const store of ledger.holders(good)) if (lends(store, good)) return true;
      return false;
    },
    units: (good) => {
      const known = unitsByGood.get(good);
      if (known !== undefined) return known;
      let units = 0;
      for (const store of ledger.holders(good)) {
        if (lends(store, good)) units += unclaimedStockOf(world, ctx, undefined, store, good);
      }
      unitsByGood.set(good, units);
      return units;
    },
  };
}

/** Where a fetcher stands to draw on a store: a building at its door, a ground pile at its own node. */
function approachNode(world: World, ctx: SystemContext, terrain: TerrainGraph, store: Entity): NodeId {
  return world.has(store, Building)
    ? interactionCell(world, ctx, terrain, store)
    : entityNode(world, terrain, store);
}

/** `preference` in the seat's `order`, a good the order lacks after the rest. */
function inSeatOrder(preference: readonly number[], order: readonly number[]): readonly number[] {
  const rank = (good: number): number => {
    const at = order.indexOf(good);
    return at < 0 ? order.length : at;
  };
  return [...preference].sort((a, b) => rank(a) - rank(b));
}

/** What a store search for a recruit's gear reads: a {@link PlannerPass} or one settler's planner context. */
type ArmingSearch = Pick<PlannerPass, 'world' | 'ctx' | 'terrain' | 'targets' | 'supply'>;

/** Send the recruit for the first reachable weapon of its intent's class in the seat's order, the
 *  strongest first by default. */
function dispatchWeaponFetch(
  pass: PlannerPass,
  e: Entity,
  settler: SettlerIdentity,
  intent: keyof typeof INTENT_WEAPON_CLASS,
  barracks: Entity,
  owner: number,
): void {
  const { world, supply } = pass;
  let route: FetchRoute | undefined;
  const routeOf = (): FetchRoute => (route ??= fetchRouteFor(pass, e, owner));
  const pick = pickReachableWeapon(pass, settler.tribe, intent, owner, routeOf, null);
  if (pick === null) return;
  supply.stampPickupClaim(e, { ...pick, amount: EQUIP_FETCH_UNITS });
  world.add(e, EquipOrder, {
    group: 'weapon',
    slot: 0,
    goodType: pick.goodType,
    returnTo: barracksDoor(pass, e, barracks, routeOf().here),
    stage: 'acquire',
    issuer: 'assistant-recruit',
    queued: [],
  });
  wakeIdle(world, e); // planned onto the errand this pass
}

/** The weapon policy: the first good of the seat's order for the recruit's class that a reachable store
 *  lends, with its nearest source, `prefer` when it lends the good; null when none does. The route is
 *  resolved only once some store of the side lends a wanted row. */
function pickReachableWeapon(
  search: ArmingSearch,
  tribe: number,
  intent: keyof typeof INTENT_WEAPON_CLASS,
  owner: number,
  routeOf: () => FetchRoute,
  prefer: Entity | null,
): ArmingSource | null {
  const { world, ctx, targets, supply } = search;
  let route: FetchRoute | undefined;
  // The route's signpost network met with the goods-search limit at its node, read once for every row.
  let gate: SpatialGate | undefined;
  const vetoed = playerGoodList(world, AssistantWeaponVetoes, owner);
  const preference = armingGoodPreference(ctx.content, tribe, intent, vetoed);
  // Without a seat order, the content-wide default the assistant window shows.
  const order =
    assistantWeaponOrder(world, owner, intent) ??
    weaponGoodsByStrength(ctx.content, INTENT_WEAPON_CLASS[intent]);
  for (const goodType of inSeatOrder(preference, order)) {
    if (prefer !== null && lendsGood(search, prefer, goodType)) return { goodType, source: prefer };
    // No store of the side lends this row: the route is not worth resolving.
    if (!storeHoldingMayLieIn(targets.bands, world, goodType, owner, supply, undefined)) continue;
    if (route === undefined) {
      route = routeOf();
      gate = targets.bands.goodsGate(route.here, owner, route.limit ?? undefined);
    }
    const source = nearestStoreHoldingWithin(
      targets.bands,
      world,
      route.here,
      goodType,
      owner,
      supply,
      gate,
      route.veto,
    );
    if (source !== null) return { goodType, source }; // else a weaker row still may be reachable
  }
  return null;
}

/**
 * Send the armed recruit for one {@link pickReachableArmor} good. True when an errand was
 * dispatched, false when no armor it may take is reachable (the caller releases the recruit unarmored).
 */
function dispatchArmorFetch(
  pass: PlannerPass,
  e: Entity,
  intent: AssistantArmingIntent,
  barracks: Entity,
  owner: number,
): boolean {
  const { world, ctx, targets } = pass;
  const route = fetchRouteFor(pass, e, owner);
  const pick = pickReachableArmor(
    world,
    ctx,
    targets,
    pass.supply,
    route.here,
    owner,
    intent,
    route.limit,
    route.veto,
    null,
  );
  if (pick === null) return false;
  pass.supply.stampPickupClaim(e, { ...pick, amount: EQUIP_FETCH_UNITS });
  world.add(e, EquipOrder, {
    group: 'armor',
    slot: 0,
    goodType: pick.goodType,
    returnTo: barracksDoor(pass, e, barracks, route.here),
    stage: 'acquire',
    issuer: 'assistant-recruit',
    queued: [],
  });
  wakeIdle(world, e); // planned onto the errand this pass
  return true;
}

/**
 * The equip drive's chain hook: the moment an assistant weapon errand lands, ask for the armor want
 * from the store the recruit stands at. Returns the armor goodType to retarget the live order at, or
 * null to end the errand there, settling the booking for a dressed recruit or one with no armor reachable.
 * The search runs over the network around the store the recruit stands at, not the drive's own gate.
 */
export function chainRecruitArmor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
  supply: SupplyTally,
  e: Entity,
  here: NodeId,
  veto: ((cell: NodeId) => boolean) | undefined,
): number | null {
  const booking = world.tryGet(e, AssistantRecruit);
  if (booking === undefined || !booking.armed || booking.intent === 'trainSoldiers') return null;
  const owner = ownerOf(world, e);
  if (owner === undefined) return null;
  if ((world.tryGet(e, Equipment)?.armor ?? null) !== null) {
    world.remove(e, AssistantRecruit); // already dressed - the booking is complete
    return null;
  }
  const limit = goodsSearchLimitAt(world, ctx.content, terrain, owner, terrain.xOf(here), terrain.yOf(here));
  const pick = pickReachableArmor(
    world,
    ctx,
    targets,
    supply,
    here,
    owner,
    booking.intent,
    limit,
    veto,
    null,
  );
  if (pick === null) {
    world.remove(e, AssistantRecruit); // no armor it may take is reachable: released unarmored
    return null;
  }
  return pick.goodType;
}

interface ArmingSource {
  readonly goodType: number;
  readonly source: Entity;
}

/** The armor policy: the first good of the seat's order for the recruit's class (strongest protection
 *  first by default) that is not off and that a reachable store holds, with its nearest source, `prefer`
 *  when it holds the good; null when none does, so a recruit may complete unarmored. */
function pickReachableArmor(
  world: World,
  ctx: SystemContext,
  targets: TargetCandidates,
  supply: SupplyTally,
  here: NodeId,
  owner: number,
  intent: AssistantArmingIntent,
  limit: NavigationLimit | null,
  veto: ((cell: NodeId) => boolean) | undefined,
  prefer: Entity | null,
): ArmingSource | null {
  const choice = assistantArmorOrder(world, owner, intent);
  for (const goodType of choice?.order ?? armorGoodsByProtection(ctx.content)) {
    if (choice?.off.includes(goodType)) continue;
    if (prefer !== null && lendsGood({ world, ctx, supply }, prefer, goodType))
      return { goodType, source: prefer };
    const source = nearestStoreHolding(
      targets.bands,
      world,
      here,
      goodType,
      owner,
      supply,
      limit ?? undefined,
      veto,
    );
    if (source !== null) return { goodType, source };
  }
  return null;
}

/** Whether a fetcher may lift a unit of `goodType` out of `store` now, past the walkers' claims there. */
function lendsGood(
  search: Pick<ArmingSearch, 'world' | 'ctx' | 'supply'>,
  store: Entity,
  goodType: number,
): boolean {
  const { world, ctx, supply } = search;
  return (
    unclaimedStockOf(world, ctx, supply, store, goodType) > 0 && mayFetchGoodFrom(world, ctx, store, goodType)
  );
}

/**
 * Dress a weapon-class recruit stepping out of its drill from the barracks' own stock, each slot on its
 * own: the weapon, and the armor, the arming pass would send him for, when the barracks holds that good.
 * A better-ranked good another reachable store holds still wins, and that slot is left to the pass's
 * errand. Owner's ruling, authored.
 */
export function armRecruitInPlace(search: ArmingSearch, e: Entity, barracks: Entity): void {
  const { world, ctx, targets, supply } = search;
  const booking = world.tryGet(e, AssistantRecruit);
  if (booking === undefined || booking.armed || booking.intent === 'trainSoldiers') return;
  const settler = world.get(e, Settler);
  const owner = ownerOf(world, e);
  if (owner === undefined || !isSoldierJob(ctx.content, settler.jobType)) return;
  if (!isBarracks(world, ctx, barracks) || !sameSide(world, e, barracks)) return;
  const { intent } = booking;
  let route: FetchRoute | undefined;
  const routeOf = (): FetchRoute => (route ??= fetchRouteFor(search, e, owner));
  if ((world.tryGet(e, Equipment)?.weapon ?? null) === null) {
    const weapon = pickReachableWeapon(search, settler.tribe, intent, owner, routeOf, barracks);
    if (weapon?.source === barracks) equipFromStore(world, ctx, e, barracks, weapon.goodType, 'weapon', 0);
  }
  if ((world.tryGet(e, Equipment)?.armor ?? null) === null) {
    const { here, limit, veto } = routeOf();
    const armor = pickReachableArmor(world, ctx, targets, supply, here, owner, intent, limit, veto, barracks);
    if (armor?.source === barracks) equipFromStore(world, ctx, e, barracks, armor.goodType, 'armor', 0);
  }
  // Both slots filled here: the booking has nothing left for the arming pass.
  if (
    world.tryGet(e, AssistantRecruit)?.armed === true &&
    (world.tryGet(e, Equipment)?.armor ?? null) !== null
  )
    world.remove(e, AssistantRecruit);
}

/** The unarmored damage column (`damagevalue 0`), the strength axis the weapon preference sorts on. */
const BARE_TARGET = 0;

/** Where an arming outing ends: the door of the booking's barracks, or where the outing leaves him (null)
 *  when that barracks is gone or another side's at dispatch. A barracks lost later still draws him to its
 *  old door. */
function barracksDoor(pass: PlannerPass, e: Entity, barracks: Entity, here: NodeId): NodeId | null {
  const { world, ctx, terrain } = pass;
  if (!isBarracksOrFoundation(world, ctx, barracks) || !sameSide(world, e, barracks)) return null;
  return interactionCell(world, ctx, terrain, barracks, here);
}

/** The recruit's store-search inputs, resolved once per dispatch attempt. `limit` is the settlement
 *  network at the recruit's feet, not its own confinement, which the equip drive owns and re-applies
 *  to every step of the walk. */
interface FetchRoute {
  readonly here: NodeId;
  readonly limit: NavigationLimit | null;
  readonly veto: ((cell: NodeId) => boolean) | undefined;
}

function fetchRouteFor(search: ArmingSearch, e: Entity, owner: number): FetchRoute {
  const { world, ctx, terrain } = search;
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return {
    here: terrain.nodeAtClamped(n.hx, n.hy),
    limit: goodsSearchLimitAt(world, ctx.content, terrain, owner, n.hx, n.hy),
    veto: unreachableGoalVeto(world, ctx, e),
  };
}
