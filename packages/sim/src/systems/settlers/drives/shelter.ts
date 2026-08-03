import { ownerOf, type SettlerIdentity, Sheltering } from '../../../components/index.js';
import type { Fixed } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { releaseShelter, type ShelterSite, type ShelterSites } from '../../defence/index.js';
import { sheltersOnAlarm } from '../../readviews/index.js';
import type { NavigationLimit } from '../../signposts/index.js';
import { enterBuilding, isInside } from '../indoors.js';
import { interactionCell } from '../targets/index.js';
import { isUnreachableGoal, unreachableGoals } from '../unreachable-goals.js';
import { answerNeedInPlace } from './needs.js';

/**
 * THE RUN FOR COVER - the top rung of the drive ladder while its owner has a building on alarm: a
 * civilian drops whatever it was doing, runs to the nearest defence-mode building with room, and waits
 * inside shooting the house bow (the CombatSystem's half).
 *
 * NOTHING TAKES A SHELTERING SETTLER BACK OUT while the alarm stands (user rule) - not hunger, not
 * fatigue, not a wedding, not a chat, and it does not flee. This rung is where that holds: it sits above
 * the needs drives AND above the ladder's ownership gate, so no lower rung is ever consulted. The
 * wedding/gossip drives run their own walks before the planner and stand down against a claim of their
 * own accord. A player MOVE order still walks the unit out, and this rung walks it straight back on
 * arrival: to move people, lower the alarm.
 *
 * A settler that already holds a claim keeps it - the pick is made once, and the DefenceSystem is what
 * breaks it.
 *
 * Source basis: the mode is extracted; that civilians shelter in it, who counts as a civilian, and how
 * many fit are named approximations (user rules).
 */
export function planShelter(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: SettlerIdentity & { hunger: Fixed; fatigue: Fixed },
  here: NodeId,
  from: HalfCellNode,
  limit: NavigationLimit | null,
  shelters: ShelterSites,
): boolean {
  const held = world.tryGet(e, Sheltering)?.shelter;
  if (held !== undefined) return walkInto(world, ctx, terrain, e, settler, held, here, limit);
  if (shelters.size === 0 || !sheltersOnAlarm(ctx.content, settler.jobType)) return false;
  const owner = ownerOf(world, e);
  if (owner === undefined) return false;
  const shelter = nearestShelterWithRoom(world, ctx, terrain, e, owner, here, from, limit, shelters);
  if (shelter === null) return false;
  shelter.free--;
  world.add(e, Sheltering, { shelter: shelter.entity });
  return walkInto(world, ctx, terrain, e, settler, shelter.entity, here, limit);
}

/**
 * The nearest of the player's shelters that still has room and whose door this settler may head for
 * ({@link doorIsWalkable} - an outlying gatherer with no road home simply keeps working). Ties break on
 * the canonical ascending entity id the ledger is already sorted by.
 */
function nearestShelterWithRoom(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  player: number,
  here: NodeId,
  from: HalfCellNode,
  limit: NavigationLimit | null,
  shelters: ShelterSites,
): ShelterSite | null {
  const failed = unreachableGoals(world, ctx, e);
  let best: ShelterSite | null = null;
  let bestDistance = 0;
  for (const site of shelters.get(player) ?? []) {
    if (site.free <= 0) continue;
    // Rank on the straight-line node distance to the building, and resolve a door only for a candidate
    // that beats the running best: the door resolve walks the footprint's approach cells, too much to
    // pay for every site on the list.
    const distance = Math.abs(site.hx - from.hx) + Math.abs(site.hy - from.hy);
    if (best !== null && distance >= bestDistance) continue;
    if (!doorIsWalkable(interactionCell(world, ctx, terrain, site.entity, here), limit, failed)) continue;
    best = site;
    bestDistance = distance;
  }
  return best;
}

/** Whether this settler may head for `door`: inside its signpost confinement (the alarm does not suspend
 *  the work-area rule) and not a goal its routes have just failed to reach. Both the claim pick and the
 *  walk below test it, so a seat can never be held by a settler that cannot take it. */
function doorIsWalkable(
  door: NodeId,
  limit: NavigationLimit | null,
  failed: ReturnType<typeof unreachableGoals>,
): boolean {
  if (limit !== null && !limit.allowsNode(door)) return false;
  return !isUnreachableGoal(failed, door);
}

/**
 * Walk `e` to its shelter's door and step it inside on arrival, then hold it there. What it carries is
 * all it can answer a need with under cover ({@link answerNeedInPlace}) - eating and drinking take it
 * nowhere; a walk to a larder or a bed would take it back out.
 *
 * Returns false only when the door has stopped being walkable ({@link doorIsWalkable}) - the claim is
 * given up rather than held, so this settler falls through to its trade instead of standing outside a
 * door forever. The freed seat reappears on the next tick's ledger, not on this pass's copy of it.
 */
function walkInto(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  settler: SettlerIdentity & { hunger: Fixed; fatigue: Fixed },
  shelter: Entity,
  here: NodeId,
  limit: NavigationLimit | null,
): boolean {
  if (isInside(world, e, shelter)) {
    answerNeedInPlace(world, ctx, e, settler);
    return true;
  }
  const door = interactionCell(world, ctx, terrain, shelter, here);
  if (!doorIsWalkable(door, limit, unreachableGoals(world, ctx, e))) {
    releaseShelter(world, e);
    return false;
  }
  enterBuilding(world, e, shelter, here, door);
  return true;
}
