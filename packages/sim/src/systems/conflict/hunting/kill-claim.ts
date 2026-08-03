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

// Which BODIES are a hunter's work: the kill claim that keeps two hunters off one carcass, and the
// one-kill gate's probe that stops a hunter hunting while its own kill lies unbanked. Read by the
// acquisition spec (./spec.ts) and by the economy's gatherer drive.

/**
 * Whether `carcass` is a body a fellow hunter of the same player still owns - the ONE HUNTER PER KILL
 * rule (user rule 2026-08-03): a kill is its killer's work, so a colleague neither walks over to pluck
 * it nor lets it block its own hunting through the one-kill gate.
 *
 * The claim LAPSES the moment its killer stops being someone who will come back for the body: it died,
 * left the trade, was taken off hunting duty (only the IGNORE stance runs the hunt-and-fetch cycle - a
 * hunter posted to DEFEND stands its anchor and never reaches the economy drives), its ground stopped
 * covering the spot, or its own routes just failed there. Without that, one command or one bad route
 * would strand a body nobody may take, and nothing rots a carcass. A rival player's kill is no claim at
 * all: contested game stays contested, and a rival could otherwise reserve every body in the player's
 * own ground. An UNOWNED killer (fixtures only) is compatible with every player by `sameSide`, so its
 * kill binds all of them. A node with no killer mark (map-seeded, fixture-placed) is nobody's claim.
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
 * Whether the hunter's ground still holds a carcass node its trade can harvest - the one-kill gate's
 * probe: standing work means no new target. An existence-only box query over the resource region index
 * ({@link anyResourceNear}, reach = the ground's radius plus the kill slack, a Manhattan superset),
 * each hit checked for units left, the job's atomic grant, and the exact in-reach distance. It must not
 * out-claim the harvest drive: a carcass the hunter provably cannot bank - a colleague's claimed kill,
 * one across a static terrain component seam, or one on a cell its routes just failed on
 * ({@link unreachableGoals}) - counts as no work, else a body it may never pluck would stall its
 * hunting for good. Cost is unmeasured (docs/tickets/sim/hunter-scan-costs-bench.md).
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
