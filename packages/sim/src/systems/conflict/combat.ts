import { Anger, Building, Health, Owner, Position, Settler } from '../../components/index.js';
import type { Entity } from '../../ecs/world.js';
import type { System } from '../context.js';
import { garrisonSeats } from '../defence/index.js';
import { isAggressiveAnimal, isAnimalTribe } from '../readviews/index.js';
import { canonicalById, entityNode, NodeBuckets } from '../spatial/nodes.js';
import { attackableBuildings, combatPossible } from './dormancy.js';
import { engageCombatant } from './engage-combatant.js';
import { MeleeSlots } from './melee-slots.js';
import { HostilePresence } from './presence.js';
import { type BuildingBodyNodeCache, buildingBodyNodes } from './target-node.js';

// Re-exported so the public surface (the systems barrel + tests) keeps its single combat import
// site after the conflict/ split; the rest of the folder stays internal to it.
export { REPATH_CADENCE } from './chase.js';
export { DEFEND_LEASH_NODES, DEFEND_RADIUS_NODES } from './engagement.js';
export { SIGHT_RADIUS_NODES } from './targeting.js';

/**
 * CombatSystem - the combat loop's decision stage: for each combatant, pick who to fight and either swing at
 * an enemy in reach or advance on one spotted but out of reach. The AtomicSystem's `attack` effect lands the
 * hit and the CleanupSystem reaps the felled. A combatant is a {@link Settler} carrying a {@link Health}
 * pool, so the system is inert on non-combat settlers. Each tick:
 *
 *  1. Dormancy gate ({@link combatPossible}) - one cheap pass decides whether any hostile pair (or any
 *     lingering combat state to clean up) exists; if not, a map of peaceful settlers, or an all-one-player
 *     field, costs nothing (the RTS-scale budget).
 *  2. Spatial index - all combatants are bucketed by tile once ({@link NodeBuckets}), so a seeker's
 *     "nearest enemy" query is a bounded grid ring search ({@link NodeBuckets.nearest}) instead of an
 *     O(entities) full scan per seeker. The search finishes the whole minimum-distance band and picks
 *     (distance, then id) - the same winner a full scan would, so the pick stays order-independent.
 *  3. Per combatant ({@link engageCombatant}): the stance ladder. An owned unit acts on its military mode;
 *     an unowned one carries no stance and acts on the content hostility relations alone.
 *
 * Two hostility axes compose into the `mayTarget` relation (targeting.ts):
 *  - Owner (player) hostility - two owned combatants of different players are enemies, same player friendly,
 *    so a player's mixed-tribe army never fights itself. Binary: no diplomacy/alliances.
 *  - Tribe hostility + predation + provoked anger (`mayAttack`/`mayHunt`/{@link Anger}) - the
 *    content relations for any pair where at least one side is unowned: civ-vs-civ by tribe,
 *    civ⇄aggressive-animal, hunter→huntable-prey, and a struck `getAngry` animal fighting back.
 *
 * Two reach radii: the weapon's extracted `[minRange, maxRange]` band is where a swing lands, while the
 * approximated {@link SIGHT_RADIUS_NODES} is how far an owned combatant spots an enemy to advance on. A
 * hostile wild animal advances too, within its shorter `ANIMAL_AGGRO_RADIUS_NODES` ambush radius.
 */
export const combatSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to measure reach over
  const terrain = ctx.terrain;

  // The dormancy gate runs over the raw (unsorted) query: it is order-independent (Set membership + a
  // boolean any-match), so an idle standing army pays only an O(combatants) scan, not the O(c log c)
  // canonical sort, on a tick with no fight.
  if (!combatPossible(world, ctx, world.query(Settler, Health, Position))) return;

  // The seekers (who decide + swing) are settlers; the SCAN order and the ring-search index are built from
  // the canonical (ascending-id) list, so a distance/first-match tie-break lands on the same winner.
  const combatants = canonicalById(world.query(Settler, Health, Position));
  // Attackable buildings JOIN the target index (never the seeker loop): a warrior can strike an enemy
  // building, but a building never engages. Both index and presence bucket a building at its wall cells
  // (buildingBodyNodes) - the faces a warrior reaches it from - so the reach math and the coarse early-out
  // agree with the chase target. The merged list stays canonical so ring-search ties are stable.
  const targets = canonicalById([...combatants, ...attackableBuildings(world)]);
  // A building never moves within a tick, so its wall nodes are memoized once and shared by the index/
  // presence build and every chaser's reach + chase resolution (combatTargetNode), instead of re-translating
  // the footprint per lookup.
  const bodyNodes: BuildingBodyNodeCache = new Map();
  // A unit buckets at its own node; a building at EVERY wall cell (buildingBodyNodes), so a ring search
  // finds it at the distance to its nearest face and a seeker near any side wakes to it - the siege spreads
  // around the whole footprint instead of queueing at one door.
  const nodesOf = (e: Entity): { x: number; y: number }[] => {
    if (!world.has(e, Building)) return [terrain.coordsOf(entityNode(world, terrain, e))];
    return buildingBodyNodes(world, ctx, terrain, e, bodyNodes).map((n) => terrain.coordsOf(n));
  };
  // Wildlife classes for the presence grid's discounts. Pure reads only: the lapsed-Anger reap stays with
  // the attacker pass (hostileAnimalNow).
  const wildClassOf = (t: Entity): 'passive' | 'hostile' | null => {
    if (world.has(t, Owner)) return null;
    const s = world.tryGet(t, Settler);
    if (s === undefined || !isAnimalTribe(ctx.content, s.tribe)) return null;
    if (isAggressiveAnimal(ctx.content, s.tribe)) return 'hostile';
    const anger = world.tryGet(t, Anger);
    return anger !== undefined && ctx.tick < anger.until ? 'hostile' : 'passive';
  };
  // The coarse presence grid: the owned seekers' "any enemy possibly in range?" early-out, so a standing
  // army on a peaceful two-player map skips its per-fighter ring searches (golden rule 6). It spans
  // buildings too, so a lone army near an undefended enemy base still wakes to raze it.
  const presence = new HostilePresence(world, wildClassOf);
  // The index build feeds the grid as it walks: same list, same resolver, so a separate presence pass would
  // re-resolve every target's nodes (a building's whole wall ring) for nodes it has already been handed.
  const index = new NodeBuckets(world, targets, undefined, nodesOf, presence.addNode);

  const slots = new MeleeSlots(world, ctx, terrain);
  const seats = garrisonSeats(world);
  for (const e of combatants) {
    engageCombatant(world, ctx, terrain, index, presence, slots, bodyNodes, seats, e);
  }
};
