import { Health, Position, Settler } from '../../components/index.js';
import type { System } from '../context.js';
import { garrisonSeats } from '../defence/index.js';
import { canonicalById } from '../spatial/nodes.js';
import { BattleFront } from './battle-alert.js';
import { CombatIndex } from './combat-index.js';
import { attackableBuildings, combatPossible } from './dormancy.js';
import { engageCombatant } from './engage-combatant.js';
import { MeleeSlots } from './melee-slots.js';
import type { CombatPass } from './pass.js';

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
 * a peaceful map costs nothing. The {@link CombatIndex} then answers a seeker's nearest-enemy query from the
 * coarse cells around it rather than with an O(entities) scan per seeker.
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

  // The scan order and the target index are built from the canonical (ascending-id) list, so a
  // distance or first-match tie-break lands on the same winner.
  const combatants = canonicalById(world.query(Settler, Health, Position));
  const pass: CombatPass = {
    // Attackable buildings join the target index but never the seeker loop: a warrior can strike an enemy
    // building, but a building never engages.
    index: new CombatIndex(world, ctx, terrain, combatants, attackableBuildings(world)),
    slots: new MeleeSlots(world, ctx, terrain),
    seats: garrisonSeats(world),
    bands: new Map(),
    front: new BattleFront(world, ctx),
  };
  for (const e of combatants) engageCombatant(world, ctx, terrain, pass, e);
};
