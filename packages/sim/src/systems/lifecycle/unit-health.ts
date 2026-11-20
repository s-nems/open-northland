import { type ContentSet, unitVariantFor } from '@open-northland/data';
import { Health, type SettlerIdentity } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { monsterRulesOf } from '../readviews/tribes/monsters.js';

/** Original default; class and monster exceptions are content, and an authored spawn may override its
 *  initial pool. */
export const HUMAN_HITPOINTS = 5000;

export function unitHitpoints(content: ContentSet, identity: SettlerIdentity): number {
  return (
    unitVariantFor(content, identity)?.hitpoints ??
    monsterRulesOf(content, identity.tribe)?.hitpoints ??
    HUMAN_HITPOINTS
  );
}

/** Authored rule: preserve the health fraction on a form change, rounding down with a living minimum of one HP. */
export function resizeUnitHealth(world: World, e: Entity, previous: number, next: number): void {
  const health = world.tryGet(e, Health);
  if (previous === next || health === undefined) return;
  const changed = world.mut(e, Health);
  changed.hitpoints =
    health.hitpoints <= 0 ? 0 : Math.max(1, Math.floor((health.hitpoints * next) / health.max));
  changed.max = next;
}
