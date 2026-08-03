import {
  HUNTER_WORK_FLAG_RADIUS,
  HuntFocus,
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
 * share it, so a kill the leash permits is banked. Not airtight: the uninterruptible draw plus the
 * flight can carry a runner past even this band - a rare stranded decal, never a wedge (the gate
 * cannot see past the band either).
 */
export const HUNT_CARCASS_SLACK_NODES = HUNT_CHASE_SLACK_NODES + 4;

/**
 * How long (ticks) a hunter's prey acquisition rests after a search that found nothing (`HuntRest` - the
 * cost rationale lives on the component). 10 ticks ≈ 0.8 s: a ~10x amortization the player cannot see.
 * Pure pacing, no source basis.
 */
export const HUNT_SEARCH_REST_TICKS = 10;

/**
 * The hunter's target-acquisition spec, and the owner of the ONE-KILL-AT-A-TIME rule (user rule): while
 * the ground holds a harvestable carcass ({@link huntingGroundHoldsCarcass}) the hunter takes no new
 * target - the harvest drive carries the kill home first - and the carry leg after the last pickup is
 * shielded a rung above (`carriesKillHome`). Accepts only huntable prey inside the hunting ground
 * ({@link huntingGround}), the ground anchor leashing the chase; never `hold` - an idle hunter belongs
 * to its flag-gatherer drive. Last-resort livestock (huntPrey `lastResort`; user rule) is deprioritized
 * (`lowPriority`: normal game always wins). A hunter with neither flag nor workplace (an unposted
 * fixture) hunts by plain sight, unanchored.
 *
 * It also owns the ONE-PREY-AT-A-TIME rule (user rule): the spec's `lock` holds the animal the hunter
 * drew on until it drops, out to the CHASE LEASH rather than the tighter acquisition radius - prey bolts
 * on the first arrow, so expiring at the acquisition line would restore the very swap the lock prevents.
 * Building the spec MUTATES: a lock this tick's rules no longer admit is reaped as it is read.
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
  const hereNode = entityNode(world, terrain, e);
  const hunterComponent = terrain.componentOf(hereNode);
  // An animal across a static terrain seam (an island, the far bank) is not this hunter's game: taking
  // it would hold the unit in a chase re-issuing a route that can never resolve. The same rule the
  // carcass gate below applies to a stranded kill.
  const acceptPrey = (t: Entity): boolean =>
    isHuntTarget(world, ctx, t, jobType) &&
    terrain.componentOf(entityNode(world, terrain, t)) === hunterComponent &&
    seesTarget(t);
  const lastResortLivestock = (t: Entity): boolean => {
    const s = world.tryGet(t, Settler);
    return s !== undefined && isLastResortPrey(ctx.content, s.tribe);
  };
  // `player` is null in every hunter spec: a hunter is never presence-gated, in any stance - its prey
  // filter admits the passive wildlife the presence grid discounts (see HostilePresence).
  const ground = huntingGround(world, terrain, e);
  if (ground === null) {
    // Unanchored (an unposted fixture): plain sight bounds the acquisition, so it bounds the hold too.
    const inSight = (t: Entity): boolean =>
      manhattan(terrain, hereNode, entityNode(world, terrain, t)) <= sight;
    return {
      accept: acceptPrey,
      minDist,
      searchRadius: sight,
      player: null,
      lowPriority: lastResortLivestock,
      lock: { target: livePrey(world, e, (t) => acceptPrey(t) && inSight(t)) },
      defend: null,
    };
  }
  // Lazily memoized per engage: probed at most once, on the first candidate (or held target) to reach it.
  let carcassWork: boolean | null = null;
  const groundHasCarcassWork = (): boolean =>
    (carcassWork ??= huntingGroundHoldsCarcass(world, ctx, terrain, e, jobType, ground));
  const within = (t: Entity, reach: number): boolean =>
    manhattan(terrain, ground.anchorCell, entityNode(world, terrain, t)) <= reach;
  const accept = (t: Entity): boolean => acceptPrey(t) && within(t, ground.radius) && !groundHasCarcassWork();
  const leash = ground.radius + HUNT_CHASE_SLACK_NODES;
  const held = (t: Entity): boolean => acceptPrey(t) && within(t, leash) && !groundHasCarcassWork();
  return {
    accept,
    minDist,
    // From wherever the hunter stands, `dist(here, anchor) + radius` provably covers every in-ground
    // candidate (triangle inequality) - and collapses to ~radius when it stands on its ground, where
    // the naive `radius + leash` band would ring-walk 4x the nodes every awake tick.
    searchRadius: manhattan(terrain, hereNode, ground.anchorCell) + ground.radius,
    player: null,
    lowPriority: lastResortLivestock,
    lock: { target: livePrey(world, e, held) },
    defend: { anchorCell: ground.anchorCell, leash, hold: false },
  };
}

/** Commit `target` as this hunter's prey for the ticks to come - the write half of the `lock` the spec
 *  reads back. A stance that re-acquires freely instead SHEDS a hold left from an earlier one (a hunter
 *  switched to DEFEND fights under general hostility; its half-finished hunt is over) - only the hunting
 *  branch can reap it, so nothing else would. A hold already on `target` is left untouched, keeping a
 *  long chase off the store's change generations. */
export function holdPrey(world: World, e: Entity, spec: EngageSpec, target: Entity): void {
  if (spec.lock === null) {
    world.remove(e, HuntFocus);
    return;
  }
  if (world.tryGet(e, HuntFocus)?.target !== target) world.add(e, HuntFocus, { target });
}

/** The prey this hunter is still committed to - its {@link HuntFocus} target while `holds` admits it,
 *  else null with the lapsed lock reaped here, so a hunter whose animal died, was banked, or outran the
 *  leash acquires freely again. `holds` runs only when a lock exists, keeping the carcass probe it
 *  closes over off the empty-handed path. */
function livePrey(world: World, e: Entity, holds: (t: Entity) => boolean): Entity | null {
  const focus = world.tryGet(e, HuntFocus);
  if (focus === undefined) return null;
  if (holds(focus.target)) return focus.target;
  world.remove(e, HuntFocus);
  return null;
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
 * probe: standing work means no new target. An existence-only box query over the resource region index
 * ({@link anyResourceNear}, reach = the ground's radius plus the kill slack, a Manhattan superset),
 * each hit checked for units left, the job's atomic grant, and the exact in-reach distance. It must not
 * out-claim the harvest drive: a carcass the hunter provably cannot bank - across a static terrain
 * component seam, or on a cell its routes just failed on ({@link unreachableGoals}) - counts as no
 * work, else one stranded kill would stall all hunting. Cost is unmeasured
 * (docs/tickets/sim/hunter-scan-costs-bench.md).
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
