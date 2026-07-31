import {
  HUNTER_WORK_FLAG_RADIUS,
  JobAssignment,
  Position,
  Resource,
  Settler,
  WorkFlag,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isLastResortPrey } from '../readviews/index.js';
import { isUnreachableGoal, unreachableGoals } from '../settlers/unreachable-goals.js';
import { entityNode, manhattan } from '../spatial/nodes.js';
import { anyResourceNear } from '../spatial/resources.js';
import type { EngageSpec } from './engagement.js';
import { isHuntTarget } from './targeting.js';

// The hunter's HUNTING GROUND - the prey-acquisition policy an owned IGNORE hunter engages under.
// Split out of engagement.ts (the stance dispatch) so the ground/tiering rules live in one place:
// where a hunter hunts, which prey tier it takes, and when livestock is genuinely on the menu.

/**
 * How far (Manhattan nodes) past its hunting ground's radius a hunter's chase may step - the hunting
 * twin of the DEFEND overshoot (`DEFEND_LEASH_NODES` - `DEFEND_RADIUS_NODES` = 4), so a hunter can
 * walk up to game right at the area edge without pursuing a fleeing herd across the map.
 * Approximated (source basis "Combat stances").
 */
export const HUNT_CHASE_SLACK_NODES = 4;

/**
 * How far (Manhattan nodes) past the ground's radius a hunter's carcass may lie and still be its work:
 * the chase overshoot ({@link HUNT_CHASE_SLACK_NODES}) plus a drift margin for prey that keeps fleeing
 * between the release and the arrow's contact. The carcass-gate probe and the hunter's harvest reach
 * share it, so every kill the leash permits is also banked - never stranded past an invisible line.
 */
export const HUNT_CARCASS_SLACK_NODES = HUNT_CHASE_SLACK_NODES + 4;

/**
 * How long (ticks) a hunter's prey acquisition rests after a search that found nothing (`HuntRest` - the
 * cost rationale lives on the component). 10 ticks ≈ 0.8 s: a ~10x amortization the player cannot see.
 * Pure pacing, no source basis.
 */
export const HUNT_SEARCH_REST_TICKS = 10;

/**
 * The hunter's target-acquisition spec: accept only huntable prey inside the hunting ground
 * ({@link huntingGround} - the work-flag area, or the {@link HUNTER_WORK_FLAG_RADIUS} circle around the
 * bound workplace), with the ground anchor leashing the chase (never `hold` - an idle hunter belongs to
 * its flag-gatherer drive, and a combat walk-back would fight that drive for the unit every tick). ALL
 * prey is carcass-gated ({@link huntingGroundHoldsCarcass}): while the ground holds a harvestable
 * carcass the hunter takes no new target and the planner-owned harvest drive carries the kill home
 * first - one kill at a time (user rule), not a herd wiped out ahead of the banking. The carry leg
 * after the LAST pickup (carcass gone, load on the back) is shielded a rung above this spec
 * (`carriesKillHome` in engage-combatant.ts). Last-resort livestock (huntPrey `lastResort` - sheep,
 * oxen kept for a future husbandry; user rule) is additionally deprioritized (`lowPriority`: normal
 * game always wins). A hunter with neither flag nor workplace (an unposted fixture) hunts by plain
 * sight, unanchored.
 */
export function hunterEngageSpec(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  jobType: number | null,
  seesTarget: (t: Entity) => boolean,
  minDist: number,
  sight: number,
): EngageSpec {
  const acceptPrey = (t: Entity): boolean => isHuntTarget(world, ctx, t, jobType) && seesTarget(t);
  const lastResortLivestock = (t: Entity): boolean => {
    const s = world.tryGet(t, Settler);
    return s !== undefined && isLastResortPrey(ctx.content, s.tribe);
  };
  // `player` is null in every hunter spec: a hunter is never presence-gated, in any stance - its prey
  // filter admits the passive wildlife the presence grid discounts (see HostilePresence).
  const ground = huntingGround(world, terrain, e);
  if (ground === null) {
    return {
      accept: acceptPrey,
      minDist,
      searchRadius: sight,
      player: null,
      lowPriority: lastResortLivestock,
      defend: null,
    };
  }
  // Lazily memoized per engage: probed once, when the first in-ground candidate is reached.
  let carcassWork: boolean | null = null;
  const groundHasCarcassWork = (): boolean =>
    (carcassWork ??= huntingGroundHoldsCarcass(world, ctx, terrain, e, jobType, ground));
  const accept = (t: Entity): boolean =>
    acceptPrey(t) &&
    manhattan(terrain, ground.anchorCell, entityNode(world, terrain, t)) <= ground.radius &&
    !groundHasCarcassWork();
  return {
    accept,
    minDist,
    // From wherever the hunter stands, `dist(here, anchor) + radius` provably covers every in-ground
    // candidate (triangle inequality) - and collapses to ~radius when it stands on its ground, where
    // the naive `radius + leash` band would ring-walk 4x the nodes every awake tick.
    searchRadius: manhattan(terrain, entityNode(world, terrain, e), ground.anchorCell) + ground.radius,
    player: null,
    lowPriority: lastResortLivestock,
    defend: { anchorCell: ground.anchorCell, leash: ground.radius + HUNT_CHASE_SLACK_NODES, hold: false },
  };
}

/**
 * The area an owned hunter hunts: its work-flag circle (the same yard its carcass-harvest drive
 * works), or - employed at a stocking building instead ({@link JobAssignment}; the two are mutually
 * exclusive, see `syncWorkFlagToJob`) - the {@link HUNTER_WORK_FLAG_RADIUS} circle around that
 * workplace. Null for a hunter with neither.
 */
function huntingGround(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
): { anchorCell: NodeId; radius: number } | null {
  const flag = world.tryGet(e, WorkFlag);
  if (flag !== undefined && world.has(flag.flag, Position)) {
    const p = world.get(flag.flag, Position);
    const n = nodeOfPosition(p.x, p.y);
    return { anchorCell: terrain.nodeAtClamped(n.hx, n.hy), radius: flag.radius };
  }
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  if (workplace !== undefined && world.has(workplace, Position)) {
    const p = world.get(workplace, Position);
    const n = nodeOfPosition(p.x, p.y);
    return { anchorCell: terrain.nodeAtClamped(n.hx, n.hy), radius: HUNTER_WORK_FLAG_RADIUS };
  }
  return null;
}

/**
 * Whether the hunter's ground still holds a carcass node its trade can harvest - the one-kill gate's
 * probe: standing work means no new target. An existence-only box query over the resource
 * region index ({@link anyResourceNear}, reach = the ground's radius plus the kill slack, a Manhattan
 * superset), each hit checked for units left, the job's atomic grant, and the exact in-reach distance.
 * Hunters are a handful per map and the probe memoizes per engage.
 *
 * The probe must not out-claim the harvest drive: a carcass the hunter provably cannot bank - across a
 * static terrain-component seam (a ranged kill over water), or on a cell its routes just failed on
 * ({@link unreachableGoals}) - counts as no work, else one stranded kill would stall all hunting.
 *
 * Cost: the memo is per-engage, so an active chase re-probes each tick, and a carcass-less probe tests
 * every indexed resource in the {@link HUNTER_WORK_FLAG_RADIUS} box. Unmeasured; if a bench on a
 * resource-dense ground shows it, bound it (docs/tickets/sim/combat-spatial-rebuild-per-tick.md).
 */
function huntingGroundHoldsCarcass(
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
    if (terrain.componentOf(cell) !== hunterComponent) return false;
    if (isUnreachableGoal(memo, cell)) return false;
    return manhattan(terrain, ground.anchorCell, cell) <= reach;
  });
}
