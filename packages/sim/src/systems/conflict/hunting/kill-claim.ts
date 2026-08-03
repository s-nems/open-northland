import { KilledBy, Resource, Settler } from '../../../components/index.js';
import { sameSide } from '../../../components/ownership.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { isHunterJob, MILITARY_MODE, stanceMode } from '../../readviews/index.js';
import { isUnreachableGoal, unreachableGoals } from '../../settlers/unreachable-goals.js';
import { entityNode, manhattan } from '../../spatial/nodes.js';
import { anyResourceNear } from '../../spatial/resources.js';
import { HUNT_CARCASS_SLACK_NODES, huntingGround } from './ground.js';

// Which bodies are a hunter's work: the kill claim that keeps two hunters off one carcass, and the
// one-kill gate's probe that stops a hunter hunting while its own kill lies unbanked.

/**
 * Whether `carcass` is a body a fellow hunter of the same player still owns - the one-hunter-per-kill rule
 * (authored): a kill is its killer's work, so a colleague neither walks over to pluck it nor lets it block
 * its own hunting through the one-kill gate.
 *
 * The claim lapses the moment its killer stops being someone who will come back for the body, else one
 * command or one bad route would strand a body nobody may take and nothing rots a carcass. A rival
 * player's kill is no claim at all: contested game stays contested. An unowned killer (fixtures only) is
 * compatible with every player by `sameSide`, so its kill binds all of them.
 */
export function claimedByAnotherHunter(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  carcass: Entity,
  hunter: Entity,
): boolean {
  const killer = world.tryGet(carcass, KilledBy)?.by;
  if (killer === undefined || killer === hunter || !world.isAlive(killer)) return false;
  if (!sameSide(world, killer, hunter)) return false;
  const jobType = world.tryGet(killer, Settler)?.jobType ?? null;
  if (!isHunterJob(ctx.content, jobType)) return false;
  if (stanceMode(world, ctx.content, killer, jobType) !== MILITARY_MODE.IGNORE) return false;
  const at = entityNode(world, terrain, carcass);
  if (isUnreachableGoal(unreachableGoals(world, ctx, killer), at)) return false;
  const ground = huntingGround(world, terrain, killer);
  if (ground === null) return true; // an unposted hunter roams by sight - it has no ground to fall out of
  return manhattan(terrain, ground.anchorCell, at) <= ground.radius + HUNT_CARCASS_SLACK_NODES;
}

/**
 * Whether the hunter's ground still holds a carcass node its trade can harvest - the one-kill gate's probe:
 * standing work means no new target. The box query is a Manhattan superset, so each hit is re-checked at its
 * exact distance. It must not out-claim the harvest drive: a carcass the hunter provably cannot bank - a
 * colleague's claimed kill, one across a static terrain component seam, or one on a cell its routes just
 * failed on - counts as no work, else a body it may never pluck would stall its hunting for good. Cost is
 * unmeasured.
 */
export function huntingGroundHoldsCarcass(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  hunter: Entity,
  jobType: number | null,
  ground: { anchorCell: NodeId; radius: number },
): boolean {
  if (jobType === null) return false;
  const allowed = contentIndex(ctx.content).atomicsByJob.get(jobType);
  if (allowed === undefined) return false;
  const memo = unreachableGoals(world, ctx, hunter);
  const hunterComponent = terrain.componentOf(entityNode(world, terrain, hunter));
  const ax = terrain.xOf(ground.anchorCell);
  const ay = terrain.yOf(ground.anchorCell);
  // The slack band: a kill the chase leash permitted may fall past the radius - still this hunter's work.
  const reach = ground.radius + HUNT_CARCASS_SLACK_NODES;
  return anyResourceNear(world, ax, ay, reach, (node) => {
    const res = world.get(node, Resource);
    if (res.remaining <= 0 || !allowed.has(res.harvestAtomic)) return false;
    const cell = entityNode(world, terrain, node);
    // Cheapest first: an array read and a ≤8-entry memo walk before the claim resolves a killer.
    if (terrain.componentOf(cell) !== hunterComponent) return false;
    if (isUnreachableGoal(memo, cell)) return false;
    if (manhattan(terrain, ground.anchorCell, cell) > reach) return false;
    return !claimedByAnotherHunter(world, ctx, terrain, node, hunter);
  });
}
