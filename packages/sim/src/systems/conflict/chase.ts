import { AttackOrder, Engagement, MoveGoal, PathRequest } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { standingFighterNodes } from '../movement/collision/index.js';
import { clearNavState, entityNode, isTravelling, manhattan, redirectRoute } from '../spatial.js';

// The walk-into-melee half of combat: advance an owned combatant on an out-of-reach enemy, deal each chaser a
// distinct contact cell (the melee-slot rule that forms ranks, not a pile), respect the DEFEND leash, and drop
// engagement state when the unit hands back to the economy. Internal to conflict/; {@link combatSystem} drives
// it. See ./engagement.ts for target acquisition.

/** Per-combat-tick melee-slot state: the lazily-built standing-body node set plus this tick's
 *  already-claimed approach cells. */
export interface MeleeSlots {
  standing?: ReadonlySet<NodeId>;
  readonly claimed: Set<NodeId>;
}

/**
 * How many ticks a chaser follows its current path toward an enemy before re-issuing a fresh one — the chase
 * repath throttle. A chaser tracks a moving enemy by re-pathing periodically, not every tick; a per-tick full
 * re-path of every chaser would be the RTS-scale regression golden rule 7 forbids (and would eat the
 * pathfinder's per-tick node budget — `routing.ts`). Between repaths the unit keeps walking its last route, and
 * the swing check is distance-based (independent of the path goal), so a slightly-stale route still delivers it
 * into reach. Our design (no oracle) — source basis "Combat chase / repath cadence".
 */
export const REPATH_CADENCE = 8;

/** Send a DEFEND unit back to its anchor when no enemy is in its defend radius: drop the {@link Engagement} and
 *  either hold in place (already home — clear any stale route) or walk home (a fresh {@link MoveGoal} to the
 *  anchor). With the leash in {@link chase}, this is the "engage in a radius, don't chase far, return to post"
 *  behaviour of the DEFEND mode. */
export function returnToAnchor(world: World, e: Entity, here: NodeId, anchorCell: NodeId): void {
  world.remove(e, Engagement);
  clearChase(world, e);
  if (here !== anchorCell) world.add(e, MoveGoal, { cell: anchorCell });
}

/**
 * Advance an owned combatant on `target` it can't yet reach — the walk-into-melee drive. It keeps an
 * {@link Engagement} marker (so the AISystem leaves the unit to combat) and re-issues a {@link MoveGoal} toward
 * an {@link approachCell} (a cell in the weapon's reach band of the target, closest to the unit — so a melee
 * unit stops adjacent rather than walking onto the enemy) at most every {@link REPATH_CADENCE} ticks. Between
 * repaths it follows its live route; the swing check (distance-based) catches it the instant it steps into
 * reach. A dead route (an unreachable target) is dropped so it re-issues; an ordered unit whose route can't
 * resolve gives the order up (the "becomes unreachable" end of an attack order).
 */
export function chase(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  slots: MeleeSlots,
  e: Entity,
  here: NodeId,
  target: Entity,
  weapon: { minRange: number; maxRange: number },
  ordered: boolean,
  defend: { anchorCell: NodeId; leash: number } | null,
): void {
  const engagement = world.add(e, Engagement, {
    repathAt: world.tryGet(e, Engagement)?.repathAt ?? ctx.tick, // repath now on first engagement
  });

  // A failed chase route (unreachable target): drop the dead nav state so we re-issue below. For an explicit
  // attack order an unreachable target ends the order.
  if (world.tryGet(e, PathRequest)?.failed) {
    clearChase(world, e);
    if (ordered) {
      world.remove(e, AttackOrder);
      world.remove(e, Engagement);
      return;
    }
  }

  const travelling = isTravelling(world, e);
  if (travelling && ctx.tick < engagement.repathAt) return; // still closing on a live route — don't re-path

  const dest = approachCell(
    terrain,
    here,
    entityNode(world, terrain, target),
    weapon.minRange,
    weapon.maxRange,
    (cell) => {
      slots.standing ??= standingFighterNodes(world, terrain);
      return slots.standing.has(cell) || slots.claimed.has(cell);
    },
  );
  if (dest === null) {
    // Every walkable cell of the target's reach band is a taken slot (a standing body, or dealt to an earlier
    // chaser this tick): stand fast as a second rank — a stationary body, not a walker grinding into the first
    // rank's backs — and re-ask at the chase cadence; the slot check admits it the moment a front-liner falls
    // or steps off. With the id-order slot deal above, this turns a converging mass into ranks, not a pile.
    clearChase(world, e);
    engagement.repathAt = ctx.tick + REPATH_CADENCE;
    return;
  }
  // DEFEND leash: never step past `leash` tiles from the anchor to reach an enemy — a target hittable only by
  // breaking the leash is left alone, and the defender walks back to its post.
  if (defend !== null && manhattan(terrain, defend.anchorCell, dest) > defend.leash) {
    returnToAnchor(world, e, here, defend.anchorCell);
    return;
  }
  if (dest === here && !travelling) {
    // Standing on its own best approach cell yet out of range (else it would have swung, not chased) — the
    // target can't be closed on (boxed into an unwalkable pocket, or the two are stacked on one cell with no
    // free approach). Give up rather than loop engaged-but-frozen: `disengage` drops the Engagement + chase
    // state and any AttackOrder. Next tick the unit re-acquires another enemy, or the economy relocates it
    // (which also breaks a shared-tile stall), so it never stays stuck. Only reachable on obstructed terrain
    // when standing: an all-walkable map always yields a band cell. A travelling unit whose truncated node
    // already reads as a free band cell (mid-stride onto it) is not boxed in — it falls through and aims its
    // live route there, finishing the step and swinging next pass (the standstill-swing rule).
    disengage(world, e);
    return;
  }
  redirectRoute(world, e, dest); // keep the live route — dropping it reset the gait (chase stutter)
  slots.claimed.add(dest); // this slot is dealt — the tick's later chasers aim at the next free cell
  engagement.repathAt = ctx.tick + REPATH_CADENCE;
}

/** The cell a chaser should walk to in order to bring `target` into its weapon band: the free walkable cell
 *  (not a taken melee slot — `isTaken`: a standing body, or already dealt to an earlier chaser this tick) whose
 *  Manhattan distance to the target is in `[minRange, maxRange]` and which is closest to the unit (`from`),
 *  canonical (min distance, then min cell id). So a melee unit stops one cell short of the enemy (hittable)
 *  instead of walking onto it (distance 0, below every weapon's near reach — which would deadlock), and a mass
 *  of chasers is dealt distinct contact cells around the target instead of all converging on one — the
 *  melee-slot rule that spreads a large fight along the band. Returns `null` when the band has walkable cells
 *  but every one is taken (a full front — the chaser should hold as a second rank); falls back to the target's
 *  own cell when no in-band cell is walkable at all (a boxed-in target; the chase then closes and the
 *  swing/disengage logic re-decides). A bounded scan of the band box — O((2·maxRange+1)²), tiny for melee —
 *  deterministic (fixed order + min-id tie-break). */
function approachCell(
  terrain: TerrainGraph,
  from: NodeId,
  targetCell: NodeId,
  minRange: number,
  maxRange: number,
  isTaken: (cell: NodeId) => boolean,
): NodeId | null {
  const t = terrain.coordsOf(targetCell);
  const f = terrain.coordsOf(from);
  let best: NodeId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let anyWalkable = false;
  for (let dy = -maxRange; dy <= maxRange; dy++) {
    for (let dx = -maxRange; dx <= maxRange; dx++) {
      const band = Math.abs(dx) + Math.abs(dy);
      if (band < minRange || band > maxRange) continue; // not in the target's reach band
      const x = t.x + dx;
      const y = t.y + dy;
      if (!terrain.inBounds(x, y)) continue;
      const cell = terrain.nodeAt(x, y);
      if (!terrain.isWalkable(cell)) continue;
      anyWalkable = true;
      if (isTaken(cell)) continue; // an occupied melee slot — someone already fights (or was dealt) here
      const d = Math.abs(x - f.x) + Math.abs(y - f.y); // distance from the unit to this candidate cell
      if (d < bestDist || (d === bestDist && (best === null || cell < best))) {
        best = cell;
        bestDist = d;
      }
    }
  }
  if (best !== null) return best;
  return anyWalkable ? null : targetCell;
}

/** Drop the combatant's engagement, returning it to the economy: remove the {@link Engagement} marker and the
 *  chase movement it drove, and any {@link AttackOrder} (a dead/invalid focus). Only touches a unit that was
 *  engaged — a peaceful/economy unit with no marker keeps its own movement untouched. */
export function disengage(world: World, e: Entity): void {
  if (world.has(e, Engagement)) {
    world.remove(e, Engagement);
    clearChase(world, e);
  }
  world.remove(e, AttackOrder);
}

/** Remove the nav state a chase drove (goal + in-flight route) so combat can re-aim or hand the unit back. */
export function clearChase(world: World, e: Entity): void {
  clearNavState(world, e);
}
