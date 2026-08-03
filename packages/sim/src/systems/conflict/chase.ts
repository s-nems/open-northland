import {
  AttackOrder,
  Engagement,
  EquipOrder,
  HuntFocus,
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

// The walk-into-melee half of combat: advance an owned combatant on an out-of-reach enemy, deal each chaser
// a distinct contact cell so a converging mass forms ranks rather than a pile, and respect the DEFEND leash.

/** The chase's pre-resolved target: the entity, the combat node the reach check measured (its own node for
 *  a unit, its nearest wall for a building), and a building's full wall list (`null` for a unit). */
export interface ChaseTarget {
  readonly entity: Entity;
  readonly node: NodeId;
  readonly body: readonly NodeId[] | null;
}

type DefendPost = EngageSpec['defend'];

/**
 * How many ticks a chaser follows its current path toward an enemy before re-issuing a fresh one. A per-tick
 * full re-path of every chaser would breach the scale budget and eat the pathfinder's per-tick node budget;
 * between repaths the unit keeps walking its last route, and the distance-based swing check still catches it
 * the instant it steps into reach. Approximation (source basis "Combat chase / repath cadence").
 */
export const REPATH_CADENCE = 8;

/** Send a DEFEND unit back to its anchor when no enemy is in its defend radius. The {@link Engagement} always
 *  drops here, or the planner's Engagement gate would bench the guard for good; the walk home defers to a live
 *  equip errand, whose end re-holds the unchanged anchor. */
function returnToAnchor(world: World, e: Entity, here: NodeId, anchorCell: NodeId): void {
  world.remove(e, Engagement);
  world.remove(e, HuntFocus); // a post-holder holds no prey
  if (world.has(e, EquipOrder)) return;
  clearNavState(world, e);
  if (here !== anchorCell) world.add(e, MoveGoal, { cell: anchorCell });
}

/** Hand a combatant that will not advance this tick back to its idle duty: a post-holder walks back to its
 *  anchor, everyone else disengages. A hunter's leash carries `hold: false` because its between-hunts time
 *  belongs to the flag-gatherer drive, which a combat walk-back would fight for the unit. */
export function breakOff(world: World, e: Entity, here: NodeId, defend: DefendPost): void {
  if (defend?.hold === true) returnToAnchor(world, e, here, defend.anchorCell);
  else disengage(world, e);
}

/**
 * Advance an owned combatant on `target` it can't yet reach. It keeps an {@link Engagement} marker so the
 * PlannerSystem leaves the unit to combat, and re-issues a {@link MoveGoal} toward an {@link approachCell} at
 * most every {@link REPATH_CADENCE} ticks; between repaths it follows its live route and the distance-based
 * swing check catches it the instant it steps into reach. A dead route is dropped so it re-issues, and an
 * ordered unit whose route cannot resolve gives the order up. A building target's wall list lets a chaser
 * whose nearest face is fully manned encircle to a free slot on another face.
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
  // A failed chase route ends an explicit attack order. An attack-move march instead rests its aggression
  // and walks on: without the rest, an enemy visible across a river holds the marcher in a failing search
  // every tick and the order can never complete.
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
  // Only a cell in the chaser's own static walk component can be walked to, so the far bank is never asked
  // for. Bridges and boats are not yet walkable, so two banks really are separate; a chaser on an unwalkable
  // node (`-1`, truncated onto it mid-stride) is unlabelled and admits every cell.
  const bank = terrain.componentOf(here);
  const onOurBank = (cell: NodeId): boolean => bank < 0 || terrain.componentOf(cell) === bank;

  let dest: NodeId | null;
  if (target.body !== null && target.body.length > 0) {
    const faces = slots.encircleCandidates(target.entity, target.body, weapon);
    // Null when every slot is taken, the full-perimeter hold. With no face on our bank there is no front to
    // queue behind: aim at the body, which the release below refuses.
    dest = nearestCell(terrain, faces, here, (cell) => onOurBank(cell) && !slots.isTaken(cell, ownGoal));
    if (dest === null && !faces.some(onOurBank)) dest = target.node;
  } else {
    dest = approachCell(terrain, here, target.node, weapon, slots, ownGoal, onOurBank);
  }
  if (dest === null) {
    // Every cell of the target's reach band on our own bank is a taken slot: stand fast as a second rank and
    // re-ask at the chase cadence, which admits the unit the moment a front-liner falls or steps off.
    clearNavState(world, e);
    engagement.repathAt = ctx.tick + REPATH_CADENCE;
    return;
  }
  // `dest` fell back to the target itself: no cell that would bring it into reach is one this unit can stand
  // on. Only the walk is refused - the reach check ran before the chase, so an archer still shoots across
  // water. Giving up here is an approximation (source basis "Combat chase").
  if (!commanded && !onOurBank(dest)) {
    breakOff(world, e, here, defend);
    return;
  }
  // Anchor leash: a target hittable only by stepping past `leash` from the anchor is left alone.
  if (defend !== null && manhattan(terrain, defend.anchorCell, dest) > defend.leash) {
    breakOff(world, e, here, defend);
    return;
  }
  if (dest === here && !travelling) {
    // Standing on its own best approach cell yet out of range: the target cannot be closed on, so give up
    // rather than loop engaged-but-frozen. Next tick the unit re-acquires another enemy, or the economy
    // relocates it, so it never stays stuck. A travelling unit falls through instead, finishes its step and
    // swings next pass.
    disengage(world, e);
    return;
  }
  redirectRoute(world, e, dest); // keep the live route - dropping it reset the gait (chase stutter)
  slots.claim(dest);
  engagement.repathAt = ctx.tick + REPATH_CADENCE;
}

/** The cell a chaser should walk to in order to bring `target` into its weapon band: the {@link
 *  MeleeSlots.isOpen open}, `reachable`, untaken cell in the band that is closest to `from`, canonicalized by
 *  (distance, cell id). A melee unit therefore stops one cell short of the enemy rather than on it, where
 *  distance 0 would sit below every weapon's near reach. Returns `null` when the band has reachable open
 *  cells but every one is taken, and falls back to the target's own cell when none is open and reachable at
 *  all. The band-box scan is O((2·maxRange+1)²). */
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

/** Drop the combatant's engagement, returning it to the economy: the {@link Engagement} marker and the chase
 *  movement it drove, plus both target commitments. Only the movement of a unit that was engaged is touched,
 *  so an economy unit with no marker keeps its own. */
export function disengage(world: World, e: Entity): void {
  if (world.has(e, Engagement)) {
    world.remove(e, Engagement);
    clearNavState(world, e);
  }
  world.remove(e, AttackOrder);
  world.remove(e, HuntFocus);
}
