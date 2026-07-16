import { CurrentAtomic, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';

/**
 * The per-tick harvest-claim set: resource nodes some settler is working RIGHT NOW (a running
 * `harvest` atomic) plus the picks made earlier in this planner pass. One digger per node at a time —
 * the user-specified rule (the gatherer twin of the farm claims, `../farming/claims.ts`): a crew sent
 * to one deposit spreads over its free nodes instead of stacking on the nearest, and when no free node
 * remains the surplus gatherers wait rather than crowd a colleague's swing. A walker en route still
 * re-checks on arrival (its replan consults the claims), so two walkers converging on one node resolve
 * to one swinging and one re-targeting — never two simultaneous harvests of the same node.
 */
export type HarvestClaims = Set<Entity>;

/** Seed the tick's claims from every live harvest atomic. Membership-only (no canonical sort needed);
 *  the planner adds its own picks as it makes them, in canonical settler order. */
export function collectHarvestClaims(world: World): HarvestClaims {
  const claimed = new Set<Entity>();
  for (const e of world.query(Settler, CurrentAtomic)) {
    const effect = world.get(e, CurrentAtomic).effect;
    if (effect.kind === 'harvest') claimed.add(effect.resource);
  }
  return claimed;
}
