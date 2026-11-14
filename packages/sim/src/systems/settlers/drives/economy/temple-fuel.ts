import { Building, JobAssignment, ownerOf } from '../../../../components/index.js';
import type { Entity } from '../../../../ecs/world.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import { interactionNodeId } from '../../../footprint/interaction.js';
import { finishedTemples, templeFuelShortfall } from '../../../lifecycle/temple/index.js';
import { templeFuelGoods, templeFuelSlotOf } from '../../../readviews/index.js';
import { jobLimitAt, landReachAt } from '../../../signposts/index.js';
import { mergedRecipeOf } from '../../../stores/index.js';
import { walkFetchInput, walkPickupBatch } from '../../atomics/start.js';
import type { PlannerContext } from '../../planner/context.js';
import { nearestStoreHolding, unclaimedStockOf } from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';

/** One unit per trip, as every craftsman's fetch carries. */
const FUEL_RUN_UNITS = 1;

/** A temple short of fuel and the fuel it burns. */
export interface ShortTemple {
  readonly temple: Entity;
  readonly goodType: number;
}

/**
 * Of the settler's player's finished temples whose fuel `burns` admits and whose store still takes a unit
 * beyond what it holds and the loads on their way, the one holding least, so every temple gets a unit
 * before any fills; the nearest by Manhattan distance to its door on a tie, then the lower id. Only a
 * door inside `gate` counts. Null when none. A player's temples are few, so they are walked rather than
 * searched.
 */
export function templeShortOf(
  plan: PlannerContext,
  burns: (goodType: number) => boolean,
  gate: SpatialGate,
  avoid: ((cell: NodeId) => boolean) | undefined,
): ShortTemple | null {
  const { world, ctx, terrain, here, owner, supply } = plan;
  if (owner === undefined) return null;
  let best: ShortTemple | null = null;
  let bestShortfall = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const temple of finishedTemples(world, ctx)) {
    if (ownerOf(world, temple) !== owner) continue;
    const type = world.tryGet(temple, Building)?.buildingType;
    const goodType = type === undefined ? undefined : templeFuelSlotOf(ctx.content, type)?.goodType;
    if (goodType === undefined || !burns(goodType)) continue;
    const shortfall = templeFuelShortfall(world, ctx, supply, temple);
    if (shortfall <= 0 || shortfall < bestShortfall) continue;
    const door = interactionNodeId(world, ctx, terrain, temple);
    if (door === null || !gate.allowsNode(door) || avoid?.(door) === true) continue;
    const distance =
      Math.abs(terrain.xOf(door) - terrain.xOf(here)) + Math.abs(terrain.yOf(door) - terrain.yOf(here));
    if (shortfall === bestShortfall && distance >= bestDistance) continue;
    best = { temple, goodType };
    bestShortfall = shortfall;
    bestDistance = distance;
  }
  return best;
}

/**
 * Where a settler looks for a temple to feed: inside the confinement the door of his post carries for his
 * trade, so the walk toward one temple never brings a farther one into a range that moves with him and
 * draws him past his post's reach. A settler with no post, or a trade nothing confines, keeps `own`.
 */
export function templeFeedGate(plan: PlannerContext, own: SpatialGate): SpatialGate {
  const { world, ctx, terrain, entity, owner, jobType } = plan;
  const post = world.tryGet(entity, JobAssignment)?.workplace;
  if (post === undefined || owner === undefined) return own;
  const door = interactionNodeId(world, ctx, terrain, post);
  if (door === null) return own;
  return jobLimitAt(world, ctx.content, terrain, jobType, owner, terrain.xOf(door), terrain.yOf(door)) ?? own;
}

/**
 * A craftsman whose workplace makes a temple's fuel carries a unit to a temple of his player that runs
 * short of it inside his signpost reach ({@link templeShortOf}), before any other work but a batch he is
 * running: out of his own workplace's stock, else from the nearest store holding one. The delivery rung
 * then takes the unit to a short temple. Owner ruling: the druids feed the temples themselves, porters
 * and traders only help. True when it sent him.
 */
export function planTempleFuelRun(plan: PlannerContext, workplace: Entity): boolean {
  const { world, ctx, terrain, entity, here, owner, supply, targets } = plan;
  if (owner === undefined) return false;
  const fuels = templeFuelGoods(ctx);
  const outputs = mergedRecipeOf(world, ctx, workplace)?.outputs;
  if (outputs === undefined || !outputs.some((line) => fuels.has(line.goodType))) return false;
  if (finishedTemples(world, ctx).length === 0) return false;
  const gate = templeFeedGate(plan, plan.limit ?? landReachAt(terrain, here));
  const avoid = unreachableGoalVeto(world, ctx, entity);
  const makes = (goodType: number): boolean => outputs.some((line) => line.goodType === goodType);
  const short = templeShortOf(plan, makes, gate, avoid);
  if (short === null) return false;
  const { temple, goodType } = short;
  if (unclaimedStockOf(world, ctx, supply, workplace, goodType) > 0) {
    supply.stampSupplyRun(entity, { site: temple, goodType, amount: FUEL_RUN_UNITS });
    walkPickupBatch(plan, workplace, goodType, undefined, FUEL_RUN_UNITS);
    return true;
  }
  const store = nearestStoreHolding(targets.bands, world, here, goodType, owner, supply, gate, avoid);
  if (store === null) return false;
  supply.stampSupplyRun(entity, { site: temple, goodType, amount: FUEL_RUN_UNITS });
  walkFetchInput(plan, store, goodType, false, FUEL_RUN_UNITS);
  return true;
}
