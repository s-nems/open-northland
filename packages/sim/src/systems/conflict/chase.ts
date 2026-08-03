import {
  AttackOrder,
  Engagement,
  EquipOrder,
  MoveGoal,
  PathRequest,
  PlayerOrder,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { nearestCell } from '../footprint/geometry.js';
import { clearNavState, closer, isTravelling, manhattan, redirectRoute } from '../spatial/nodes.js';
import type { CombatantStance, EngageSpec } from './engagement.js';
import type { MeleeSlots, WeaponBand } from './melee-slots.js';

// The walk-into-melee half of combat: advance an owned combatant on an out-of-reach enemy, deal each chaser a
// distinct contact cell (the melee-slot rule that forms ranks, not a pile), respect the DEFEND leash, and drop
// engagement state when the unit hands back to the economy. Internal to conflict/; {@link combatSystem} drives
// it. See ./engagement.ts for target acquisition.

/** The chase's pre-resolved target: the entity (the encircle-band memo key), the combat node the reach
 *  check measured (its own node for a unit, its nearest wall for a building), and a building's full wall
 *  list (`null` for a unit) - derived together in {@link engageCombatant} and passed whole. */
export interface ChaseTarget {
  readonly entity: Entity;
  readonly node: NodeId;
  readonly body: readonly NodeId[] | null;
}

type DefendPost = EngageSpec['defend'];

/**
 * How many ticks a chaser follows its current path toward an enemy before re-issuing a fresh one - the chase
 * repath throttle. A chaser tracks a moving enemy by re-pathing periodically, not every tick; a per-tick full
 * re-path of every chaser would be the RTS-scale regression golden rule 7 forbids (and would eat the
 * pathfinder's per-tick node budget - `routing.ts`). Between repaths the unit keeps walking its last route, and
 * the swing check is distance-based (independent of the path goal), so a slightly-stale route still delivers it
 * into reach. Our design (no oracle) - source basis "Combat chase / repath cadence".
 */
export const REPATH_CADENCE = 8;

/** Send a DEFEND unit back to its anchor when no enemy is in its defend radius: drop the {@link Engagement} and
 *  either hold in place (already home - clear any stale route) or walk home (a fresh {@link MoveGoal} to the
 *  anchor). With the leash in {@link chase}, this is the "engage in a radius, don't chase far, return to post"
 *  behaviour of the DEFEND mode. The Engagement ALWAYS drops here (the planner's Engagement gate would
 *  otherwise bench the guard for good), but the walk home defers to a live equip errand - clearing the
 *  nav state mid-fetch would tug the guard off it; the errand's end re-holds the unchanged anchor. */
function returnToAnchor(world: World, e: Entity, here: NodeId, anchorCell: NodeId): void {
  world.remove(e, Engagement);
  if (world.has(e, EquipOrder)) return;
  clearNavState(world, e);
  if (here !== anchorCell) world.add(e, MoveGoal, { cell: anchorCell });
}

/** Hand a combatant that will not advance this tick back to its idle duty: a post-holder (DEFEND, `hold`)
 *  walks back to its anchor, everyone else disengages. A hunter's leash carries `hold: false` for exactly
 *  this reason - its between-hunts time belongs to the flag-gatherer drive, and a combat walk-back would
 *  fight that drive for the unit. */
export function breakOff(world: World, e: Entity, here: NodeId, defend: DefendPost): void {
  if (defend?.hold === true) returnToAnchor(world, e, here, defend.anchorCell);
  else disengage(world, e);
}

/**
 * Advance an owned combatant on `target` it can't yet reach - the walk-into-melee drive. It keeps an {@link
 * Engagement} marker (so the PlannerSystem leaves the unit to combat) and re-issues a {@link MoveGoal} toward
 * an {@link approachCell} (a cell in the weapon's reach band of `target.node`, closest to the unit - so a
 * melee unit stops adjacent rather than walking onto the enemy) at most every {@link REPATH_CADENCE} ticks.
 * Between repaths it follows its live route; the swing check (distance-based) catches it the instant it steps
 * into reach. A contact cell the terrain walls off is never walked toward at all; a dead route (a target the
 * crowd sealed off) is dropped so it re-issues, and an ordered unit whose route can't resolve gives the order
 * up (the "becomes unreachable" end of an attack order). `target` carries the caller's pre-resolved combat
 * node (so the chase closes on the same cell the reach check measured) and a building target's full wall
 * list, which lets a chaser whose nearest face is fully manned encircle to a free slot on another face
 * ({@link MeleeSlots.encircleCandidates}) instead of holding behind the first rank.
 */
export function chase(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  slots: MeleeSlots,
  e: Entity,
  here: NodeId,
  target: ChaseTarget,
  weapon: WeaponBand,
  stance: CombatantStance,
  defend: DefendPost,
): void {
  const engagement = world.add(e, Engagement, {
    repathAt: world.tryGet(e, Engagement)?.repathAt ?? ctx.tick, // repath now on first engagement
  });

  const marching = world.tryGet(e, PlayerOrder)?.attackMove !== undefined;
  const commanded = stance.ordered || marching; // a player-driven chase - it releases here, not on the bank
  // A failed chase route (unreachable target): drop the dead nav state so we re-issue below. For an explicit
  // attack order an unreachable target ends the order. An attack-move march instead rests its aggression and
  // walks on: without the rest, an enemy visible across a river holds the marcher in a failing search every
  // tick and the order can never complete.
  if (world.tryGet(e, PathRequest)?.failed) {
    clearNavState(world, e);
    if (commanded) {
      world.remove(e, AttackOrder);
      world.remove(e, Engagement);
      if (marching) {
        world.write(e, PlayerOrder, (order) => {
          if (order.attackMove !== undefined) order.attackMove.blockedUntil = ctx.tick + REPATH_CADENCE;
        });
      }
      return;
    }
  }

  const travelling = isTravelling(world, e);
  if (travelling && ctx.tick < engagement.repathAt) return; // still closing on a live route - don't re-path

  const ownGoal = world.tryGet(e, MoveGoal)?.cell;
  // Only a cell in the chaser's own static walk component can be walked to - the labels `findPath` refutes a
  // cross-component goal with, so the far bank is never asked for. Bridges and boats are not yet walkable, so
  // two banks really are separate (`targets/resources.ts` names the same limitation); a chaser on an
  // unwalkable node (`-1`, truncated onto it mid-stride) is unlabelled and admits every cell.
  const bank = terrain.componentOf(here);
  const onOurBank = (cell: NodeId): boolean => bank < 0 || terrain.componentOf(cell) === bank;

  // A building's slots are dealt against its whole wall list ({@link MeleeSlots.encircleCandidates}), so a
  // chaser whose nearest face is fully manned spills around the perimeter to the next open face instead of
  // holding behind the first rank.
  let dest: NodeId | null;
  if (target.body !== null && target.body.length > 0) {
    const faces = slots.encircleCandidates(target.entity, target.body, weapon);
    // The untaken candidate nearest the unit - null when every slot is taken, the full-perimeter hold. With no
    // face on our bank there is no front to queue behind: aim at the body, which the release below refuses.
    dest = nearestCell(terrain, faces, here, (cell) => onOurBank(cell) && !slots.isTaken(cell, ownGoal));
    if (dest === null && !faces.some(onOurBank)) dest = target.node;
  } else {
    dest = approachCell(terrain, here, target.node, weapon, slots, ownGoal, onOurBank);
  }
  if (dest === null) {
    // Every cell of the target's reach band on our own bank is a taken slot (a standing body, or dealt to an
    // earlier chaser this tick): stand fast as a second rank - a stationary body, not a walker into the first
    // rank's backs - and re-ask at the chase cadence; the slot check admits it the moment a front-liner falls
    // or steps off. With the id-order slot deal above, this turns a converging mass into ranks, not a pile.
    clearNavState(world, e);
    engagement.repathAt = ctx.tick + REPATH_CADENCE;
    return;
  }
  // `dest` fell back to the target itself: no cell that would bring it into reach is one this unit can stand
  // on. Hand back rather than stay engaged on an enemy it will never touch - only the WALK is refused, since
  // the reach check ran before the chase and an archer still shoots across water. Giving up is an
  // approximation (source basis "Combat chase"); holding benches the unit for good, so it is no alternative.
  if (!commanded && !onOurBank(dest)) {
    breakOff(world, e, here, defend);
    return;
  }
  // Anchor leash: never step past `leash` tiles from the anchor to reach an enemy - a target hittable only by
  // breaking the leash is left alone.
  if (defend !== null && manhattan(terrain, defend.anchorCell, dest) > defend.leash) {
    breakOff(world, e, here, defend);
    return;
  }
  if (dest === here && !travelling) {
    // Standing on its own best approach cell yet out of range (else it would have swung, not chased) - the
    // target can't be closed on (boxed into an unwalkable pocket, or the two are stacked on one cell with no
    // free approach). Give up rather than loop engaged-but-frozen: `disengage` drops the Engagement + chase
    // state and any AttackOrder. Next tick the unit re-acquires another enemy, or the economy relocates it
    // (which also breaks a shared-tile stall), so it never stays stuck. Only reachable on obstructed terrain
    // when standing: an all-walkable map always yields a band cell. A travelling unit whose truncated node
    // already reads as a free band cell (mid-stride onto it) is not boxed in - it falls through and aims its
    // live route there, finishing the step and swinging next pass (the standstill-swing rule).
    disengage(world, e);
    return;
  }
  redirectRoute(world, e, dest); // keep the live route - dropping it reset the gait (chase stutter)
  slots.claim(dest);
  engagement.repathAt = ctx.tick + REPATH_CADENCE;
}

/** The cell a chaser should walk to in order to bring `target` into its weapon band: the {@link
 *  MeleeSlots.isOpen open}, `reachable`, untaken cell whose Manhattan distance to the target is in the band
 *  and which is closest to the unit (`from`), canonical (min distance, then min cell id). So a melee unit
 *  stops one cell short of the enemy (hittable) instead of walking onto it (distance 0, below every weapon's
 *  near reach - which would deadlock), and a mass of chasers is dealt distinct contact cells around the
 *  target instead of all converging on one - the melee-slot rule that spreads a large fight along the band.
 *  Returns `null` when the band has reachable open cells but every one is taken (a full front - the chaser
 *  should hold as a second rank); falls back to the target's own cell when none is open and reachable at all
 *  (a boxed-in or cross-bank target; the caller then refuses the walk, or the chase closes and the
 *  swing/disengage logic re-decides). A bounded scan of the band box - O((2·maxRange+1)²), tiny for melee -
 *  deterministic (fixed order + min-id tie-break). */
function approachCell(
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  weapon: WeaponBand,
  slots: MeleeSlots,
  ownGoal: NodeId | undefined,
  reachable: (cell: NodeId) => boolean,
): NodeId | null {
  const t = terrain.coordsOf(targetCell);
  const f = terrain.coordsOf(from);
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  let anyReachable = false;
  for (let dy = -weapon.maxRange; dy <= weapon.maxRange; dy++) {
    for (let dx = -weapon.maxRange; dx <= weapon.maxRange; dx++) {
      const band = Math.abs(dx) + Math.abs(dy);
      if (band < weapon.minRange || band > weapon.maxRange) continue; // not in the target's reach band
      const x = t.x + dx;
      const y = t.y + dy;
      if (!terrain.inBounds(x, y)) continue;
      const cell = terrain.nodeAt(x, y);
      if (!slots.isOpen(cell) || !reachable(cell)) continue;
      anyReachable = true;
      if (slots.isTaken(cell, ownGoal)) continue; // someone already fights (or was dealt) here
      const d = Math.abs(x - f.x) + Math.abs(y - f.y); // distance from the unit to this candidate cell
      if (closer(d, cell, bestDist, bestCell)) {
        best = cell;
        bestDist = d;
        bestCell = cell;
      }
    }
  }
  if (best !== null) return best;
  return anyReachable ? null : targetCell;
}

/** Drop the combatant's engagement, returning it to the economy: remove the {@link Engagement} marker and the
 *  chase movement it drove, and any {@link AttackOrder} (a dead/invalid focus). Only touches a unit that was
 *  engaged - a peaceful/economy unit with no marker keeps its own movement untouched. */
export function disengage(world: World, e: Entity): void {
  if (world.has(e, Engagement)) {
    world.remove(e, Engagement);
    clearNavState(world, e);
  }
  world.remove(e, AttackOrder);
}
