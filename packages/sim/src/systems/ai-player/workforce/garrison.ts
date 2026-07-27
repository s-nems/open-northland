import {
  aiModuleRuns,
  CurrentAtomic,
  Owner,
  ownerOf,
  Settler,
  TrainingOrder,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { drillTrainingGain } from '../../progression/index.js';
import { baseSoldierJobType, isBarracks, isFighterJob } from '../../readviews/index.js';
import { EXERCISE_ATOMIC_ID } from '../../settlers/actions.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { drillDoorOpen } from '../../settlers/training.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { ownedBuildings } from '../shared.js';
import type { SpareForce } from './pool.js';

/**
 * The standing army a seat keeps once it has a barracks. A flat cap, not a share of the population: our
 * balance choice, sized so a soldier is a man the economy can spare (the user asked the AI to train part
 * of its spare settlers; the number is ours).
 */
export const GARRISON_TARGET = 6;

/**
 * The garrison hire: send a true surplus man to the barracks, where the drill enlists him
 * (`settlers/training.ts`) — the seat's only route to a soldier (`schoolingMet`).
 *
 * Runs last in the workforce ladder, so a recruit is a man no collector post, no building slot, no builder
 * reserve and no flag wanted. One man per decision, so the labour force steps down gradually instead of
 * losing a whole garrison's worth on the tick the surplus first appears. Recruits already walking to the
 * barracks count toward the target (the pool excludes them too), so a decision never over-orders while the
 * previous batch is still drilling. The seat picks its lowest-id built barracks — a canonical pick, not the
 * nearest: the drill's cost is the walk, and re-picking per recruit would send one batch to two houses.
 *
 * The seat's `military` HAI toggle gates it, even though it runs inside the workforce allocator: the
 * allocator is the one module allowed to claim a settler, so the army is hired here rather than in a run
 * slot of its own.
 */
export function trainGarrison(
  world: World,
  ctx: SystemContext,
  player: number,
  force: SpareForce,
): Command[] {
  if (!aiModuleRuns(world, player, 'military')) return [];
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // mapless sim: no door to walk to
  if (baseSoldierJobType(ctx.content) === null) return []; // content with no soldier class to enlist into
  const house = garrisonHouse(world, ctx, player);
  if (house === null) return [];
  if (garrisonStrength(world, ctx, player) >= GARRISON_TARGET) return [];
  const door = interactionCell(world, ctx, terrain, house);
  const recruit = force.take((e) => isDrillCandidate(world, ctx, terrain, e, door));
  // No eligible surplus this decision — the rest waits for grown sons.
  return recruit === null ? [] : [{ kind: 'trainSoldier', entity: recruit, house }];
}

/** The seat's soldiers plus the recruits already committed to a drill. A count, so it walks the settlers
 *  in store order rather than paying for a canonical sort it cannot observe. */
function garrisonStrength(world: World, ctx: SystemContext, player: number): number {
  let held = 0;
  for (const e of world.query(Settler, Owner)) {
    if (ownerOf(world, e) !== player) continue;
    if (world.has(e, TrainingOrder) || isFighterJob(ctx.content, world.get(e, Settler).jobType)) held++;
  }
  return held;
}

/** The seat's lowest-id standing barracks, or null when it has none yet. */
function garrisonHouse(world: World, ctx: SystemContext, player: number): Entity | null {
  for (const e of ownedBuildings(world, player)) {
    if (isBarracks(world, ctx, e)) return e;
  }
  return null;
}

/**
 * Whether a spare man may be sent to drill. Three exclusions, all about a hire that would repeat forever:
 * a settler mid-action would have that action stomped by the order (the same hazard the scout hire
 * avoids); a settler whose tribe binds no schooling exercise clip banks nothing however long it drills;
 * and a settler the barracks door is shut to would be handed the errand only for the drill rung to
 * abandon it next tick. A man who drilled and was interrupted keeps his part-served schooling and is
 * eligible again — the next term finishes him.
 */
function isDrillCandidate(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  door: NodeId,
): boolean {
  if (world.has(e, CurrentAtomic)) return false;
  const s = world.tryGet(e, Settler);
  if (s === undefined || isFighterJob(ctx.content, s.jobType)) return false;
  if (drillTrainingGain(ctx.content, s, EXERCISE_ATOMIC_ID) <= 0) return false;
  return drillDoorOpen(world, ctx, e, door, navigationLimitFor(world, ctx.content, terrain, e));
}
