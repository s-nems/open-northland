import {
  Age,
  AssistantRecruit,
  Carrying,
  Equipment,
  EquipOrder,
  ownerOf,
  Position,
  Settler,
  type SettlerIdentity,
  SupplyRun,
  TrainingOrder,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import {
  ARMOR_MAIN_TYPE,
  armorByClass,
  isSoldierJob,
  weaponDamageVsMaterial,
} from '../../readviews/index.js';
import { type NavigationLimit, navigationLimitFor } from '../../signposts/index.js';
import { canonicalById } from '../../spatial/nodes.js';
import { INTENT_WEAPON_CLASS } from '../atomics/effects/goods/weapon-class.js';
import { nearestStoreHolding, type TargetCandidates } from '../targets/index.js';
import { unreachableGoalVeto } from '../unreachable-goals.js';
import { ASSISTANT_SCAN_PERIOD_TICKS } from './assistant-grants.js';
import type { PlannerPass } from './pass.js';
import { anotherSystemOwns } from './replan.js';

/**
 * The assistant's arming pass: dress each enlisted weapon-class recruit (`AssistantRecruit`, drill
 * served) from any reachable store in ONE outing - the weapon first (the good→class transform lands
 * in the equip effect, which also pays the counter), then the equip drive chains the armor want at
 * the store via {@link chainRecruitArmor} before the single walk home (user rule 2026-08-01: no
 * second trip). Weapon preference is the strongest reachable row of the intent's class, no schooling
 * gate - a soldier handles any weapon, the barracks only unlocks the profession (user rule
 * 2026-08-01). Bare-target damage decides (a long bow outranks a short one, never a good id); armor is
 * a random pick among the heavy tier's goods in store, the light tier's when no heavy is stocked,
 * and skipped entirely when neither is (the spec's "if available"). Runs on the grants pass's stride
 * beat with the same one-errand rule.
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

/** Send the recruit for the strongest reachable weapon of its intent's class it qualifies for. */
function dispatchWeaponFetch(
  pass: PlannerPass,
  e: Entity,
  settler: SettlerIdentity,
  intent: keyof typeof INTENT_WEAPON_CLASS,
  owner: number,
): void {
  const { world, ctx, terrain, targets } = pass;
  const mainType = INTENT_WEAPON_CLASS[intent];
  const candidates = ctx.content.weapons
    .filter(
      (w) =>
        w.tribeType === settler.tribe &&
        w.mainType === mainType &&
        w.goodType !== undefined &&
        w.jobType !== undefined,
    )
    // Strongest first, bare-target damage deciding (long over short); good id is only the tie-break.
    .sort(
      (a, b) =>
        weaponDamageVsMaterial(b, BARE_TARGET) - weaponDamageVsMaterial(a, BARE_TARGET) ||
        (a.goodType ?? 0) - (b.goodType ?? 0),
    );
  if (candidates.length === 0) return;
  let route: FetchRoute | undefined;
  for (const weapon of candidates) {
    const goodType = weapon.goodType;
    if (goodType === undefined) continue;
    route ??= fetchRouteFor(pass, e);
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
 * Send the armed recruit for one armor good: a seeded-random pick among the heavy tier's reachable
 * goods, the light tier's as fallback. True when an errand was dispatched, false when no tier has a
 * reachable unit (the caller releases the recruit unarmored).
 */
function dispatchArmorFetch(pass: PlannerPass, e: Entity, owner: number): boolean {
  const { world, ctx, terrain, targets } = pass;
  const route = fetchRouteFor(pass, e);
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
 */
export function chainRecruitArmor(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  targets: TargetCandidates,
  e: Entity,
  here: NodeId,
  limit: NavigationLimit | null,
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
  const pick = pickReachableArmor(world, ctx, terrain, targets, here, owner, limit, veto);
  if (pick === null) {
    world.remove(e, AssistantRecruit); // no tier reachable: released unarmored (the spec's "if available")
    return null;
  }
  return pick;
}

/** A seeded-random reachable armor good - the heavy tier's picks first, the light tier's as the
 *  fallback; null when no tier has a reachable unit. */
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

/** The recruit's store-search inputs, resolved once per dispatch attempt. */
interface FetchRoute {
  readonly here: NodeId;
  readonly limit: NavigationLimit | null;
  readonly veto: ((cell: NodeId) => boolean) | undefined;
}

function fetchRouteFor(pass: PlannerPass, e: Entity): FetchRoute {
  const { world, ctx, terrain } = pass;
  const p = world.get(e, Position);
  const n = nodeOfPosition(p.x, p.y);
  return {
    here: terrain.nodeAtClamped(n.hx, n.hy),
    limit: navigationLimitFor(world, ctx.content, terrain, e),
    veto: unreachableGoalVeto(world, ctx, e),
  };
}
