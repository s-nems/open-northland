import { CurrentAtomic, Settler } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';

/**
 * Resource nodes some settler is working right now plus the picks made earlier in this planner pass: one
 * digger per node, so a crew spreads over a deposit's free nodes and surplus gatherers wait rather than
 * crowd a colleague's swing. Claims span all owners, since two settlers cannot share one swing whoever
 * commands them. Source basis: authored.
 */
export type HarvestClaims = Set<Entity>;

/** Seed the tick's claims from every live harvest atomic. Membership-only, so no canonical sort is needed. */
export function collectHarvestClaims(world: World): HarvestClaims {
  const claimed = new Set<Entity>();
  for (const e of world.query(Settler, CurrentAtomic)) {
    const effect = world.get(e, CurrentAtomic).effect;
    if (effect.kind === 'harvest') claimed.add(effect.resource);
  }
  return claimed;
}
