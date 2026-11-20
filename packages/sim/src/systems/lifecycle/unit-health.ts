import type { ContentSet } from '@open-northland/data';
import { Health } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { monsterRulesOf } from '../readviews/tribes/monsters.js';

/** Original default; a monster's own pool is content, and an authored spawn may override its initial
 *  pool. */
export const HUMAN_HITPOINTS = 5000;

export function unitHitpoints(content: ContentSet, tribe: number): number {
  return monsterRulesOf(content, tribe)?.hitpoints ?? HUMAN_HITPOINTS;
}

/** Authored rule: preserve the health fraction when a pool changes size, rounding down with a living
 *  minimum of one HP. */
export function resizeUnitHealth(world: World, e: Entity, previous: number, next: number): void {
  const health = world.tryGet(e, Health);
  if (previous === next || health === undefined) return;
  const changed = world.mut(e, Health);
  changed.hitpoints =
    health.hitpoints <= 0 ? 0 : Math.max(1, Math.floor((health.hitpoints * next) / health.max));
  changed.max = next;
}
