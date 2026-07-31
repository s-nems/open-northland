import { aiModuleRuns, CurrentAtomic, Female, Owner, ownerOf, Settler } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { mayMarry } from '../../family/eligibility.js';
import { baseSoldierJobType, isBarracks, isFighterJob } from '../../readviews/index.js';
import { drillDoorOpen } from '../../settlers/drives/training.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { ownedBuildings } from '../shared.js';
import type { SpareForce } from './pool.js';

/**
 * The garrison hire: send a true surplus man to the barracks, where the drill enlists him
 * (`settlers/drives/training.ts`) - the seat's only route to a soldier.
 *
 * The army has no size cap (user rule: as many soldiers as the settlement can raise). Its real bound
 * is the breeding engine that grows the next recruits: a fighter neither marries nor fathers children
 * (`isOnMission`), and the conversion is one-way, so the hire drafts only a BACHELOR beyond the
 * seat's waiting brides ({@link bachelorSurplus}). Married men and the last matchable bachelors stay
 * civilians, keeping every family line producing the sons the garrison drafts later.
 *
 * Runs last in the workforce ladder, so a recruit is a man no collector post, no building slot, no builder
 * reserve and no flag wanted. One man per decision, so the labour force steps down gradually instead of
 * losing a whole crew's worth on the tick the surplus first appears. The seat picks its lowest-id built
 * barracks - a canonical pick, not the nearest: the drill's cost is the walk, and re-picking per recruit
 * would send one batch to two houses.
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
  if (bachelorSurplus(world, ctx, player) <= 0) return []; // every bachelor has a bride to meet
  const door = interactionCell(world, ctx, terrain, house);
  const recruit = force.take(
    (e) => mayMarry(world, ctx.content, e) && isDrillCandidate(world, ctx, terrain, e, door),
  );
  // No eligible surplus this decision - the rest waits for grown sons.
  return recruit === null ? [] : [{ kind: 'trainSoldier', entity: recruit, house }];
}

/** The seat's marriageable men beyond its marriageable women - the men the family plan will never
 *  need as husbands. {@link mayMarry} decides both sides (it already rejects a recruit committed to
 *  a drill). A commutative sum, so it walks store order rather than paying for a canonical sort it
 *  cannot observe. */
function bachelorSurplus(world: World, ctx: SystemContext, player: number): number {
  let surplus = 0;
  for (const e of world.query(Settler, Owner)) {
    if (ownerOf(world, e) !== player) continue;
    if (!mayMarry(world, ctx.content, e)) continue;
    surplus += world.has(e, Female) ? -1 : 1;
  }
  return surplus;
}

/** The seat's lowest-id standing barracks, or null when it has none yet. */
function garrisonHouse(world: World, ctx: SystemContext, player: number): Entity | null {
  for (const e of ownedBuildings(world, player)) {
    if (isBarracks(world, ctx, e)) return e;
  }
  return null;
}

/**
 * Whether a spare man may be sent to drill. Two exclusions, both about a hire that would repeat forever:
 * a settler mid-action would have that action stomped by the order (the same hazard the scout hire
 * avoids), and a settler the barracks door is shut to would be handed the errand only for the drill rung
 * to abandon it next tick. A man whose drill was interrupted is simply eligible again - the next full
 * term enlists him.
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
  return drillDoorOpen(world, ctx, e, door, navigationLimitFor(world, ctx.content, terrain, e));
}
