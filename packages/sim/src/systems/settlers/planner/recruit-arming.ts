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
 * The assistant's arming pass: dress each enlisted weapon-class recruit whose drill is served from any
 * reachable store. Authored: one outing, so the weapon is fetched first and the equip drive chains the
 * armor want at the store before the single walk home. Runs on the grants pass's stride beat with the
 * same one-errand rule.
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
      // A worn weapon with the booking still unarmed means the good landed outside the take-up
      // transform, so the slot this booking would fill is taken: release it and let the counter book
      // someone else instead of skipping forever.
      if ((eq?.weapon ?? null) !== null) {
        world.remove(e, AssistantRecruit);
        continue;
      }
      dispatchWeaponFetch(pass, e, settler, booking.intent, owner);
      continue;
    }
    // The fallback armor outing: the weapon errand normally chains the armor at the store, so this
    // only re-dispatches a recruit left armed but bare when that chained errand was lost.
    if ((eq?.armor ?? null) !== null) {
      world.remove(e, AssistantRecruit);
      continue;
    }
    if (!dispatchArmorFetch(pass, e, owner)) world.remove(e, AssistantRecruit);
  }
}

/**
 * The good types an `intent` recruit may be armed with, strongest first: bare-target damage decides and
 * the good id only breaks a tie. A row needs both a `jobtype` and a `goodtype` to arm anyone.
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
 * Which of `intents` the seat could arm a `tribe` recruit for right now: those some store inside
 * `reach` holds a good {@link armingGoodPreference} would shop for, returned in the caller's order.
 * The garrison rung sizes its standing order with this, so it applies the same goods, store rule,
 * reach and ownership rule as the dispatch below, and a neutral ground heap of swords counts like a
 * stocked warehouse. Existence only: which recruit walks there is the dispatch's problem. One walk of
 * the stores answers every intent, so the cost is the world's stores, not the stores times the classes.
 */
export function armableIntents<Intent extends keyof typeof INTENT_WEAPON_CLASS>(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  tribe: number,
  intents: readonly Intent[],
  reach: NavigationLimit | null,
): readonly Intent[] {
  // An intent whose tribe data binds no craftable class row can never be armed and is dropped here.
  const wanted = intents
    .map((intent) => ({ intent, goods: armingGoodPreference(ctx.content, tribe, intent) }))
    .filter((w) => w.goods.length > 0);
  if (wanted.length === 0) return [];
  const armable = new Set<Intent>();
  const walls = buildingBlockedCells(world, ctx, terrain);
  for (const store of world.query(Stockpile)) {
    if (armable.size === wanted.length) break;
    if (!ownersCompatible(player, ownerOf(world, store))) continue;
    let approach: NodeId | undefined;
    for (const { intent, goods } of wanted) {
      if (armable.has(intent)) continue;
      if (!goods.some((good) => storeYieldsGood(world, ctx, terrain, walls, store, good))) continue;
      approach ??= approachNode(world, ctx, terrain, store);
      if (reach === null || reach.allowsNode(approach)) armable.add(intent);
    }
  }
  return intents.filter((intent) => armable.has(intent));
}

/** Where a fetcher stands to draw on a store: a building at its door, a ground pile at its own node. */
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
  const { world, ctx, targets } = pass;
  let route: FetchRoute | undefined;
  for (const goodType of armingGoodPreference(ctx.content, settler.tribe, intent)) {
    route ??= fetchRouteFor(pass, e, owner);
    const src = nearestStoreHolding(
      targets.bands,
      world,
      route.here,
      goodType,
      owner,
      route.limit ?? undefined,
      route.veto,
    );
    if (src === null) continue; // nothing reachable holds this row; a weaker one still may
    world.add(e, EquipOrder, {
      group: 'weapon',
      slot: 0,
      goodType,
      // Armed at the stock source: walking back marched the recruit to the barracks it had just left.
      returnTo: null,
      stage: 'acquire',
      issuer: 'assistant-recruit',
      queued: [],
    });
    return;
  }
}

/**
 * Send the armed recruit for one {@link pickReachableArmor} good. True when an errand was
 * dispatched, false when no tier has a reachable unit (the caller releases the recruit unarmored).
 */
function dispatchArmorFetch(pass: PlannerPass, e: Entity, owner: number): boolean {
  const { world, ctx, targets } = pass;
  const route = fetchRouteFor(pass, e, owner);
  const pick = pickReachableArmor(world, ctx, targets, route.here, owner, route.limit, route.veto);
  if (pick === null) return false;
  world.add(e, EquipOrder, {
    group: 'armor',
    slot: 0,
    goodType: pick,
    returnTo: null, // like the weapon fetch, done at the stock source
    stage: 'acquire',
    issuer: 'assistant-recruit',
    queued: [],
  });
  return true;
}

/**
 * The equip drive's chain hook: the moment an assistant weapon errand lands, ask for the armor want
 * from the store the recruit stands at. Returns the armor goodType to retarget the live order at, or
 * null to end the errand there, settling the booking for a dressed recruit or one with no tier reachable.
 * The search runs over the network around the store the recruit stands at, not the drive's own gate.
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
  const pick = pickReachableArmor(world, ctx, targets, here, owner, limit, veto);
  if (pick === null) {
    world.remove(e, AssistantRecruit); // no tier reachable: released unarmored
    return null;
  }
  return pick;
}

/** The armor policy: a seeded-random reachable good from the heavy tier, the light tier as the
 *  fallback, null when no tier has a reachable unit, so a recruit may complete unarmored. */
function pickReachableArmor(
  world: World,
  ctx: SystemContext,
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
        targets.bands,
        world,
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

/** The unarmored damage column (`damagevalue 0`), the strength axis the weapon preference sorts on. */
const BARE_TARGET = 0;

/** The recruit's store-search inputs, resolved once per dispatch attempt. `limit` is the settlement
 *  network at the recruit's feet, not its own confinement, which the equip drive owns and re-applies
 *  to every step of the walk. */
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
