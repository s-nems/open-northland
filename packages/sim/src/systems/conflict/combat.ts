import { Anger, Building, Health, Owner, Position, Settler } from '../../components/index.js';
import type { Entity } from '../../ecs/world.js';
import type { System } from '../context.js';
import { garrisonSeats } from '../defence/index.js';
import { isAggressiveAnimal, isAnimalTribe } from '../readviews/index.js';
import { canonicalById, entityNode, NodeBuckets } from '../spatial/nodes.js';
import { attackableBuildings, combatPossible } from './dormancy.js';
import { engageCombatant } from './engage-combatant.js';
import { MeleeSlots } from './melee-slots.js';
import type { CombatPass } from './pass.js';
import { HostilePresence } from './presence.js';
import { type BuildingBodyNodeCache, buildingBodyNodes } from './target-node.js';

// Re-exported so the public surface keeps its single combat import site; the rest of the folder is internal.
export { REPATH_CADENCE } from './chase.js';
export { DEFEND_LEASH_NODES, DEFEND_RADIUS_NODES } from './engagement.js';
export { SIGHT_RADIUS_NODES } from './targeting.js';

/**
 * CombatSystem - the combat loop's decision stage: for each combatant, pick who to fight and either swing at
 * an enemy in reach or advance on one spotted but out of reach. The AtomicSystem's `attack` effect lands the
 * hit and the CleanupSystem reaps the felled. A combatant is a {@link Settler} carrying a {@link Health}
 * pool, so the system is inert on non-combat settlers.
 *
 * The dormancy gate decides in one cheap pass whether any hostile pair or lingering combat state exists, so
 * a peaceful map costs nothing. Combatants are then bucketed by tile once, making a seeker's nearest-enemy
 * query a bounded ring search rather than an O(entities) scan per seeker.
 *
 * Two reach radii: the weapon's extracted `[minRange, maxRange]` band is where a swing lands, while the
 * approximated {@link SIGHT_RADIUS_NODES} is how far an owned combatant spots an enemy to advance on.
 */
export const combatSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to measure reach over
  const terrain = ctx.terrain;

  // The dormancy gate runs over the raw query: it is order-independent, so an idle standing army pays only
  // an O(combatants) scan, not the canonical sort, on a tick with no fight.
  if (!combatPossible(world, ctx, world.query(Settler, Health, Position))) return;

  // The scan order and the ring-search index are built from the canonical (ascending-id) list, so a
  // distance or first-match tie-break lands on the same winner.
  const combatants = canonicalById(world.query(Settler, Health, Position));
  // Attackable buildings join the target index but never the seeker loop: a warrior can strike an enemy
  // building, but a building never engages.
  const targets = canonicalById([...combatants, ...attackableBuildings(world)]);
  // A building never moves within a tick, so its wall nodes are memoized once and shared by the index and
  // presence build and every chaser's reach and chase resolution.
  const bodyNodes: BuildingBodyNodeCache = new Map();
  // A unit buckets at its own node, a building at every wall cell, so a ring search finds it at the distance
  // to its nearest face and the siege spreads around the whole footprint instead of queueing at one door.
  const nodesOf = (e: Entity): { x: number; y: number }[] => {
    if (!world.has(e, Building)) return [terrain.coordsOf(entityNode(world, terrain, e))];
    return buildingBodyNodes(world, ctx, terrain, e, bodyNodes).map((n) => terrain.coordsOf(n));
  };
  // Wildlife classes for the presence grid's discounts. Pure reads only: the lapsed-Anger reap stays with
  // the attacker pass.
  const wildClassOf = (t: Entity): 'passive' | 'hostile' | null => {
    if (world.has(t, Owner)) return null;
    const s = world.tryGet(t, Settler);
    if (s === undefined || !isAnimalTribe(ctx.content, s.tribe)) return null;
    if (isAggressiveAnimal(ctx.content, s.tribe)) return 'hostile';
    const anger = world.tryGet(t, Anger);
    return anger !== undefined && ctx.tick < anger.until ? 'hostile' : 'passive';
  };
  // The coarse presence grid: the owned seekers' "any enemy possibly in range?" early-out. It spans
  // buildings too, so a lone army near an undefended enemy base still wakes to raze it.
  const presence = new HostilePresence(world, wildClassOf);
  // The index build feeds the grid as it walks, so a separate presence pass never re-resolves a building's
  // whole wall ring for nodes it has already been handed.
  const index = new NodeBuckets(world, targets, undefined, nodesOf, presence.addNode);

  const pass: CombatPass = {
    index,
    presence,
    slots: new MeleeSlots(world, ctx, terrain),
    bodyNodes,
    seats: garrisonSeats(world),
    bands: new Map(),
  };
  for (const e of combatants) engageCombatant(world, ctx, terrain, pass, e);
};
