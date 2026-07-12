import { indexById } from '@vinland/data';
import {
  Age,
  AttackOrder,
  Building,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  JobAssignment,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  Weapon,
} from '../../components/index.js';
import type { Command } from '../../core/commands.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { System, SystemContext } from '../context.js';
import { bindFreshFlag, jobCanHarvest, liveWorkFlag, syncWorkFlagToJob } from '../economy/flags.js';
import { openWorkerJobFromList } from '../economy/jobs.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { defaultStanceForJob, isMilitaryMode, MILITARY_MODE } from '../readviews/index.js';

/**
 * The PLAYER-order handlers (`moveUnit` / `setJob`) + the {@link playerOrderSystem} that plays a move
 * order out as a **soft, timed override** — split out of command.ts (the dispatcher + structure
 * placement) and spawn.ts (entity creation), so the "direct control the human exerts over its own
 * units" concern has its own home.
 *
 * These are the FIRST commands that target an EXISTING entity to steer it (not create/destroy one).
 * The design is faithful to *Cultures*: settlers are autonomous, so a move order does NOT seize a unit
 * permanently — it sends the unit somewhere, has it STAND a while, then hands it back to the economy
 * AI. A worker resumes its job quickly; a soldier stands longer; and the needs drives (eat/sleep/pray)
 * can pull either away at any time (see {@link playerOrderSystem}). RTS-style box-select-and-move for
 * civilians is itself a deviation from the original's hand/profession control — recorded in
 * source basis.
 */

/**
 * How many ticks a CIVILIAN (non-combatant) unit STANDS at the ordered spot after arriving before the
 * economy AI re-tasks it. Short — a blacksmith sent somewhere pauses briefly, then walks back to work.
 * APPROXIMATED (no oracle for the original's exact dwell): 50 ticks ≈ 2.5 s at 20 Hz (source basis
 * "Player move-order dwell"). A rise-driven need (hunger/fatigue/piety) can end the hold sooner.
 */
export const MOVE_ORDER_HOLD_CIVILIAN = 50;
/**
 * How many ticks a COMBATANT (a unit carrying Health or a Weapon — a warrior) STANDS at the ordered
 * spot before the economy AI re-tasks it. Long — a warrior holds position far longer than a worker
 * (~15 s at 20 Hz), but its needs still preempt (it may wander off to eat/sleep). APPROXIMATED
 * (source basis "Player move-order dwell").
 */
export const MOVE_ORDER_HOLD_SOLDIER = 300;

/** A unit is a combatant (the longer hold) when it carries a Health pool or a wielded Weapon. */
function isCombatantUnit(world: World, e: Entity): boolean {
  return world.has(e, Health) || world.has(e, Weapon);
}

/**
 * Resolve a raw clicked node to a node the unit can actually STAND on. A click that lands on a
 * resource footprint (tree/stone/iron/gold), a building body, or an unwalkable tile (water/rock) has
 * no standable goal there — the pathfinder rejects an occupied or unwalkable goal outright, so the
 * order would fail and the unit would simply stand still (the reported bug: accidentally clicking a
 * tree stops the unit). Snap such a goal to the NEAREST walkable, unblocked node so the unit walks to
 * the edge of what was clicked instead of refusing the order. A standable click is returned untouched.
 *
 * Only STATIC blockers (resource + building footprints) and terrain are considered — transient unit
 * BODIES are deliberately ignored, so this stays consistent with the economy's exact node-coincidence
 * walks; re-aiming a goal off a standing unit is the routing surround rule's job, applied only to
 * colliders (see movement/routing.ts). The overlay is a membership VIEW ({@link dynamicBlockOverlay}),
 * so a box-select issuing one move order per selected unit never re-copies the resource overlay per
 * order.
 */
function reachableMoveGoal(world: World, ctx: SystemContext, terrain: TerrainGraph, clicked: NodeId): NodeId {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  if (terrain.isWalkable(clicked) && !blocked.has(clicked)) return clicked; // standable — no snap
  return nearestUnblockedNode(terrain, clicked, blocked) ?? clicked;
}

/** Drop a player order and the nav state it drove, returning the unit to full autonomy. */
function clearPlayerOrder(world: World, e: Entity): void {
  world.remove(e, PlayerOrder);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
}

/**
 * Order one OWNED settler to walk to (x,y) — the RTS "go there" order. It drops whatever the unit was
 * doing (a mid-action atomic, a stale route, an old goal) so the order takes effect immediately, sets
 * a fresh {@link MoveGoal} (the existing pathfinding→movement pipeline carries it out), and stamps a
 * {@link PlayerOrder} soft timed override so the unit STANDS a while on arrival before the economy AI
 * reclaims it (see {@link playerOrderSystem}).
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale target, a
 * non-settler (a building/resource can't be walked), or a NEUTRAL entity with no {@link Owner} (only a
 * player-owned unit is orderable — wildlife isn't the player's to command). A mapless sim has no cells
 * to navigate, so the order is a no-op there too. The command carries no issuing-player yet, so it
 * doesn't verify WHICH player owns the unit — the app only issues orders for the human's own units;
 * the per-player check lands with lockstep (source basis).
 */
export function moveUnit(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveUnit' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to navigate over
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Position) || !world.has(e, Owner)) return;

  const goal = reachableMoveGoal(world, ctx, terrain, terrain.nodeAtClamped(command.x, command.y));
  // The order is authoritative — cancel the unit's current action + any pending route request so it
  // obeys now, then set the new goal. (A non-interruptible-atomic exception is a deferred
  // refinement.) A live PathFollow is deliberately KEPT: the navigation planner sees a route whose
  // destination no longer matches the goal and re-routes the same tick, and the routing splice then
  // replaces the path while carrying the walker's momentum through the turn (movement inertia) —
  // dropping the path here made every redirect stop dead and re-accelerate from rest.
  world.remove(e, CurrentAtomic);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  // A move order SUPERSEDES combat: drop any auto-engagement and attack focus so the unit walks off and
  // holds instead of re-acquiring its target and fighting. Without this a soldier that was engaged keeps
  // its Engagement, the CombatSystem re-chases the enemy, and the order only ever moves it one step (the
  // reported bug). This is the same "the order is authoritative" principle applied above to the atomic +
  // route: an explicit player command overrides the autonomous drives (economy AND auto-combat).
  world.remove(e, Engagement);
  world.remove(e, AttackOrder);
  world.remove(e, Fleeing); // a move order supersedes the flee drive too (and its run gait)
  world.add(e, MoveGoal, { cell: goal });
  // A move order RELOCATES a DEFEND unit's post: the guard defends the spot it was sent to, not the
  // tile the stance was set on. Without the re-anchor, the arrived-hold combat pass (which lets an
  // ATTACK/DEFEND fighter keep its combat drive while holding) would march the guard straight back
  // to its OLD anchor the moment it found no enemy there.
  const stance = world.tryGet(e, Stance);
  if (stance !== undefined && stance.mode === MILITARY_MODE.DEFEND) stance.anchorCell = goal;
  const holdTicks = isCombatantUnit(world, e) ? MOVE_ORDER_HOLD_SOLDIER : MOVE_ORDER_HOLD_CIVILIAN;
  // expiresAt null = the hold hasn't started; playerOrderSystem begins it on arrival.
  world.add(e, PlayerOrder, { holdTicks, expiresAt: null });
}

/**
 * Change one OWNED settler's profession (the settler UI's "zmiana zawodu"): set its `Settler.jobType`
 * and reset it to a fresh idle worker of the new trade — drop the old workplace binding
 * ({@link JobAssignment}) so the JobSystem re-employs it at a building of the new job, cancel any
 * current action/route, and clear any {@link PlayerOrder} (a profession change hands the unit back to
 * the economy). The unit keeps any load it is carrying (it will still deposit it).
 *
 * Recoverable bad input (skipped, still logged): a dead/stale target, a non-settler, a NEUTRAL entity
 * (no {@link Owner}), an unknown `jobType` (absent from the jobs table), or a still-growing child (an
 * {@link Age} unit — its job class is the GrowthSystem's to set, not the player's).
 */
export function setJob(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setJob' }>,
): void {
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Owner)) return;
  if (world.has(e, Age)) return; // a growing child's job class is GrowthSystem's, not the player's
  if (indexById(ctx.content.jobs).get(command.jobType) === undefined) return; // unknown job — skip

  world.remove(e, JobAssignment); // re-employed at a building of the NEW job by the JobSystem
  reidleAsJob(world, ctx, e, command.jobType);
}

/**
 * Reset an OWNED settler to a fresh idle worker of `jobType`: set its `Settler.jobType`, cancel any
 * current action/route/hold, drop auto-combat state, stamp the new job's DEFAULT military stance (a
 * soldier→civilian flip stops auto-engaging and starts fleeing; the reverse engages — the player can
 * override afterwards with `setStance`), and SYNC the gatherer work flag to the new trade
 * ({@link syncWorkFlagToJob} — a gatherer trade gets a flag, leaving one drops it). It does NOT touch
 * {@link JobAssignment}: the caller owns the binding — {@link setJob} DROPS it (the JobSystem re-employs
 * at the first open building of the new job), while {@link assignWorker} SETS it (bind to the
 * player-chosen building). The one place the "re-idle to a new trade" reset lives, so the two employment
 * orders can't drift apart. Owned-only: the callers guard `e` is owned, so the stance stamp keeps the
 * "Stance is owned-only" invariant.
 */
function reidleAsJob(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  world.get(e, Settler).jobType = jobType;
  world.remove(e, CurrentAtomic); // cancel whatever it was doing under the old job
  world.remove(e, PlayerOrder); // an employment change returns the unit to the economy
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
  world.remove(e, Engagement); // drop any auto-combat state — the new trade re-decides its stance
  world.remove(e, AttackOrder);
  world.remove(e, Fleeing);
  stampDefaultStance(world, e, jobType);
  syncWorkFlagToJob(world, ctx, e, jobType); // a gatherer trade carries a work flag; other trades don't
}

/**
 * Assign one OWNED settler to work at a SPECIFIC `building` (the `assignWorker` command — the
 * player-directed twin of the JobSystem's automatic assignment): resolve the building's open worker
 * job in the command's `jobPriority` preference order, through the SAME per-building openness gate the
 * JobSystem applies ({@link openWorkerJobFromList} — a same-tribe, tech-enabled workplace with an
 * understaffed slot the settler qualifies for), re-idle the settler as that job, and bind it to the
 * chosen building ({@link JobAssignment}). The priority is how the app expresses the RTS intent (a
 * tradesman first, a hauler as fallback, never a gatherer) but every candidate still clears the gate,
 * so the bound settler walks to and staffs that building through the normal AI planner, exactly like an
 * auto-assigned worker — a hand assignment can never reach a state the JobSystem wouldn't.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale target, a non-settler
 * or NEUTRAL (unowned) issuer, a still-growing child (an {@link Age} unit — the GrowthSystem owns its
 * job class), a dead/stale/non-building target, or a building that offers this settler no open worker
 * job right now (full, wrong tribe, not a workplace, or gated).
 */
export function assignWorker(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'assignWorker' }>,
): void {
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Owner)) return;
  if (world.has(e, Age)) return; // a growing child's job class is GrowthSystem's, not the player's
  const b = command.building;
  if (!world.isAlive(b) || !world.has(b, Building)) return;

  const settler = world.get(e, Settler);
  const jobType = openWorkerJobFromList(
    world,
    ctx,
    b,
    settler.tribe,
    settler.experience,
    command.jobPriority,
  );
  if (jobType === null) return; // building full / wrong tribe / not a workplace / gated — no-op

  world.remove(e, JobAssignment); // drop any prior binding before re-binding to the chosen building
  // reidleAsJob also syncs the work flag; here `jobType` is a BUILDING-worker job, so the flag path only
  // ever REMOVES a stale flag (a gatherer reassigned to a building drops it). It never auto-plants: a
  // building resolves no harvest job (`openWorkerJobFromList` — "never a gatherer"), so the plant-at-feet
  // branch is unreachable through assignWorker. A future caller that DID pass a harvest job here would
  // plant the flag at the settler's current tile, not near the building — a seam to revisit if that lands.
  reidleAsJob(world, ctx, e, jobType);
  world.add(e, JobAssignment, { workplace: b });
}

/**
 * Stamp the job-based **default military stance** on an owned settler (the
 * {@link import('../readviews/stances.js').defaultStanceForJob} lookup) — the single stamp point shared
 * by the spawn handler and the profession-change handler, so the default rule lives in one place. Resets
 * the anchor to null (only `setStance(DEFEND)` sets an anchor). The caller guarantees `e` is owned; the
 * Stance component stays owned-only so no unowned/golden entity ever carries one.
 */
export function stampDefaultStance(world: World, e: Entity, jobType: number | null): void {
  world.add(e, Stance, { mode: defaultStanceForJob(jobType), anchorCell: null });
}

/**
 * Set one OWNED unit's **military stance** (the `setStance` command) — the player's control over how a
 * unit reacts to enemies (the original's `MILITARY_MODE`). It writes the new `mode` onto the unit's
 * {@link Stance}; for `DEFEND` it also captures the unit's **current tile as the anchor** (the centre of
 * the defend radius / the tile it returns to when clear), and for every other mode it clears the anchor.
 * The CombatSystem re-decides the unit's behavior from the new mode on its next pass — it disengages an
 * IGNORE unit, starts a FLEE unit running when a threat is near, holds a DEFEND unit at its anchor — so
 * the handler itself only updates the mode; it does NOT force-cancel a running swing or an explicit
 * {@link AttackOrder} (an attack order intentionally overrides the stance, e.g. IGNORE + "attack that one").
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale target, a non-settler,
 * a NEUTRAL (unowned) entity — only a player's own unit has a military mode — or a `mode` outside the five
 * {@link MILITARY_MODE} ids. Mapless is fine (a DEFEND anchor is simply null with no cells). The command
 * carries no issuing-player yet; the per-player authority check lands with lockstep.
 */
export function setStance(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setStance' }>,
): void {
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Owner)) return;
  if (!isMilitaryMode(command.mode)) return; // an out-of-range mode is bad input — skip

  // A DEFEND stance anchors on the tile the unit stands on now (the centre it guards / returns to). Every
  // other mode carries no anchor. Mapless (no terrain) leaves the anchor null — DEFEND then behaves like a
  // radius around the unit's own cell only where cells exist.
  let anchorCell: number | null = null;
  if (command.mode === MILITARY_MODE.DEFEND && ctx.terrain !== undefined && world.has(e, Position)) {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    anchorCell = ctx.terrain.nodeAtClamped(n.hx, n.hy);
  }
  world.add(e, Stance, { mode: command.mode, anchorCell });
}

/**
 * Place / move one OWNED gatherer's **work flag** to node (x,y) — the player's "work here" order (the
 * gathering twin of {@link moveUnit}, mapped from Ctrl+Right-Click). If the gatherer already carries a
 * {@link WorkFlag} whose flag entity still exists, that flag is **relocated** to (x,y) — only the marker
 * moves; the goods already dropped stay pinned to their tiles (a flag stores nothing). Otherwise a fresh
 * flag — a pure {@link DeliveryFlag} marker (no {@link Stockpile}: the harvest piles on the GROUND around
 * it, not into it) — is created there and bound with the {@link DEFAULT_WORK_FLAG_RADIUS}. From then on the
 * gatherer harvests only within that flag's radius, carries only what it dug, and banks it there
 * ({@link planGatherer}).
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a mapless sim (no cells); a dead/stale
 * target, a non-settler, a NEUTRAL (unowned) entity, or a settler whose **job cannot harvest** — only a
 * gatherer carries a work flag, so Ctrl+Right-Click on a soldier is a no-op, never a stray flag. Carries no
 * issuing-player yet; the per-player authority check lands with lockstep.
 */
export function setWorkFlag(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setWorkFlag' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless: no cells to plant a flag on
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Owner)) return;
  const jobType = world.get(e, Settler).jobType;
  if (jobType === null || !jobCanHarvest(ctx, jobType)) return; // only a gatherer carries a work flag

  // Snap to a valid node (an off-map click lands on the nearest cell, like moveUnit) and take its tile Position.
  const c = terrain.coordsOf(terrain.nodeAtClamped(command.x, command.y));
  const pos = positionOfNode(c.x, c.y);

  const live = liveWorkFlag(world, e);
  if (live !== undefined) {
    // Relocate the gatherer's existing flag — only the marker moves (Position mutated in place, as the
    // MovementSystem does). The goods already dropped are separate ground heaps pinned to their own tiles,
    // so they stay put; the gatherer just starts piling FRESH harvest around the flag's new spot.
    const p = world.get(live.flag, Position);
    p.x = pos.x;
    p.y = pos.y;
    return;
  }
  // No live flag yet (fresh gatherer, or its flag was removed) — mint one here and bind / re-point.
  bindFreshFlag(world, e, pos);
}

/**
 * Order one OWNED combatant to ATTACK a specific `target` unit (the RTS "attack that one" — the combat
 * twin of {@link moveUnit}). It stamps an {@link AttackOrder} focus the CombatSystem reads: the unit
 * chases and strikes `target` **regardless of sight radius** until the target dies / stops being a valid
 * target (source basis — the soft-override philosophy of {@link moveUnit}: the economy leaves an
 * engaged unit alone, but needs still preempt). Like a move order it is authoritative — it cancels the
 * unit's current action/route/hold so it obeys at once — and it also stamps the {@link Engagement} marker
 * up front so the AISystem skips economy planning for the unit from the very next tick (before the
 * CombatSystem's own pass re-stamps it), avoiding a one-tick economy leak.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a mapless sim (no cells to fight
 * over); a dead/stale issuer, a non-settler, a NEUTRAL (unowned — wildlife isn't the player's to command)
 * or NON-combatant (no {@link Health}) issuer; a dead/stale/non-combatant target; or a self-target.
 * Hostility is NOT checked here — the CombatSystem re-validates {@link mayTarget} each tick and drops an
 * order whose target is (or becomes) friendly, so a stale/illegal order self-corrects deterministically.
 * The command carries no issuing-player yet; the per-player authority check lands with lockstep.
 */
export function attackUnit(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'attackUnit' }>,
): void {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to fight over
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Position)) return;
  if (!world.has(e, Owner) || !world.has(e, Health)) return; // only an owned combatant may be ordered to fight
  const target = command.target;
  if (target === e) return; // a unit can't attack itself
  if (!world.isAlive(target) || !world.has(target, Settler) || !world.has(target, Health)) return;
  if (!world.has(target, Position)) return;

  // The order is authoritative — cancel the unit's current action + any in-flight route/hold so it obeys
  // now (a non-interruptible-atomic exception is a deferred refinement, as with moveUnit).
  world.remove(e, CurrentAtomic);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
  world.remove(e, PlayerOrder);
  world.remove(e, Fleeing); // an explicit attack order overrides the flee mode — stop running, fight
  world.add(e, AttackOrder, { target });
  // Stamp Engagement up front so aiSystem skips economy for this unit on the same tick the order lands;
  // repathAt = tick means the CombatSystem re-paths the chase on its first pass.
  world.add(e, Engagement, { repathAt: ctx.tick });
}

/**
 * PlayerOrderSystem — plays a move order out as a **soft, timed override** and then hands the unit
 * back to the autonomous economy. It runs just before {@link aiSystem} so an expiring hold frees the
 * unit for re-tasking in the SAME tick (no idle stall).
 *
 * Per unit under a {@link PlayerOrder}, in priority order:
 *  1. **Route failed** (an unwalkable/off-map target): the order can never be fulfilled — abandon it
 *     and clear the dead nav state (a failed {@link PathRequest} is never retried, so without this the
 *     unit would freeze on it forever).
 *  2. **Acting** (a {@link CurrentAtomic} appeared): autonomy has taken over — a need drive fired
 *     during the hold (the economy branch is gated off by this order, so only a need could) — the unit
 *     "went off to do its own thing". Drop the order (leave the atomic running).
 *  3. **Travelling** (goal/request/path present): before arrival this is the order's own walk — keep
 *     it. AFTER the hold has begun (`expiresAt` set) a fresh path instead means a need is walking the
 *     unit away (e.g. to food) — drop the order.
 *  4. **Arrived & idle**: begin the hold on first arrival (`expiresAt = tick + holdTicks`), then when
 *     the tick reaches it, remove the order so {@link aiSystem} re-tasks the unit this tick.
 *
 * While the order stands, {@link aiSystem}'s ECONOMY branch skips the unit (it stays put) but its
 * NEEDS drives still run — the faithful "worker returns to work soon; warrior holds longer; either may
 * wander off to eat/sleep" behaviour. Determinism: pure reads of the unit's components + the tick
 * counter; no RNG, no wall-clock; no-op without a terrain graph (nothing to have been ordered over).
 */
export const playerOrderSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no orders were issuable
  for (const e of world.query(Settler, PlayerOrder)) {
    const order = world.get(e, PlayerOrder);

    if (world.tryGet(e, PathRequest)?.failed) {
      clearPlayerOrder(world, e); // target unreachable — return to autonomy
      continue;
    }
    if (world.has(e, CurrentAtomic)) {
      world.remove(e, PlayerOrder); // a need took over — went off to do its own thing
      continue;
    }
    if (world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow)) {
      if (order.expiresAt !== null) world.remove(e, PlayerOrder); // a need walked it away mid-hold
      continue;
    }
    // Arrived and idle: run the hold.
    if (order.expiresAt === null) {
      order.expiresAt = ctx.tick + order.holdTicks;
    } else if (ctx.tick >= order.expiresAt) {
      world.remove(e, PlayerOrder); // hold done — economy resumes (aiSystem re-tasks this tick)
    }
  }
};
