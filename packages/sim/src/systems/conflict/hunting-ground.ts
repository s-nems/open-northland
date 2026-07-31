import {
  DEFAULT_WORK_FLAG_RADIUS,
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
 * The hunter's target-acquisition spec: accept only huntable prey inside the hunting ground
 * ({@link huntingGround} - the work-flag area, or the bound workplace's default-radius circle), with
 * the ground anchor leashing the chase (never `hold` - an idle hunter belongs to its flag-gatherer
 * drive, and a combat walk-back would fight that drive for the unit every tick). Last-resort
 * livestock (huntPrey `lastResort` - sheep, oxen kept for a future husbandry; user rule) is both
 * deprioritized (`lowPriority`: normal game always wins) and carcass-gated: taken only when the
 * ground holds no harvestable carcass either ({@link huntingGroundHoldsCarcass}) - without that gate
 * the kill drive would run ahead of the planner-owned harvest and exterminate a whole herd before
 * banking a unit. A hunter with neither flag nor workplace (an unposted fixture) hunts by plain
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
  // Lazily memoized per engage: probed only when a livestock candidate is actually reached, once.
  let carcassWork: boolean | null = null;
  const groundHasCarcassWork = (): boolean =>
    (carcassWork ??= huntingGroundHoldsCarcass(world, ctx, terrain, jobType, ground));
  const accept = (t: Entity): boolean =>
    acceptPrey(t) &&
    manhattan(terrain, ground.anchorCell, entityNode(world, terrain, t)) <= ground.radius &&
    (!lastResortLivestock(t) || !groundHasCarcassWork());
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
 * exclusive, see `syncWorkFlagToJob`) - the {@link DEFAULT_WORK_FLAG_RADIUS} circle around that
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
    return { anchorCell: terrain.nodeAtClamped(n.hx, n.hy), radius: DEFAULT_WORK_FLAG_RADIUS };
  }
  return null;
}

/**
 * Whether the hunter's ground still holds a carcass node its trade can harvest - the livestock gate's
 * probe: standing work means the hunter is not idle. An existence-only box query over the resource
 * region index ({@link anyResourceNear}, reach = the ground's radius, a Manhattan superset), each hit
 * checked for units left, the job's atomic grant, and the exact in-ground distance. Hunters are a
 * handful per map and the probe memoizes per engage.
 */
function huntingGroundHoldsCarcass(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  jobType: number | null,
  ground: { anchorCell: NodeId; radius: number },
): boolean {
  if (jobType === null) return false;
  const allowed = contentIndex(ctx.content).atomicsByJob.get(jobType);
  if (allowed === undefined) return false;
  const ax = terrain.xOf(ground.anchorCell);
  const ay = terrain.yOf(ground.anchorCell);
  return anyResourceNear(world, ax, ay, ground.radius, (node) => {
    const res = world.get(node, Resource);
    if (res.remaining <= 0 || !allowed.has(res.harvestAtomic)) return false;
    return manhattan(terrain, ground.anchorCell, entityNode(world, terrain, node)) <= ground.radius;
  });
}
