import type { SimEvent } from '@open-northland/sim';

export type BloodHit = Extract<SimEvent, { kind: 'combatHit' | 'projectileHit' }>;

export const isBloodHit = (event: SimEvent): event is BloodHit =>
  (event.kind === 'combatHit' || event.kind === 'projectileHit') &&
  event.structure !== true &&
  event.damage > 0 &&
  event.targetMaxHealth > 0;

/** The protected wound as a fraction of a full health pool, never the weapon's raw damage. */
export function bloodLoss(hit: BloodHit): number {
  return Math.max(0, Math.min(1, hit.damage / hit.targetMaxHealth));
}
