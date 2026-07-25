import type { SettlerIdentity } from '../../components/index.js';
import { Equipment } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { EAT_ATOMIC_ID, eatDuration, startAtomic } from './actions.js';

// The auto-drink half of the needs drives: a pressing settler carrying a matching draught (mead, a
// potion) drinks it IN PLACE instead of walking to food or a bed (manual: a settler "will
// automatically take it when his stomach starts to rumble"). The healing draught is deliberately NOT
// here - it is the death-save (see tryDeathSaveDraught).

/** The two bar needs a drive-drunk draught can answer (health is the death-save's). */
export type DraughtNeed = 'hunger' | 'fatigue';

/**
 * The misc slot to drink for `need`, or null when none matches. Two passes over the misc row, both
 * ascending index (deterministic - no distances, no rng): first the lowest slot whose restores cover
 * ONLY this need (the dedicated potion), then the lowest covering it at all - so plain hunger burns
 * the food potion before the dual-purpose mead sitting beside it. Empty and spent slots are skipped.
 */
export function draughtSlotFor(
  world: World,
  ctx: SystemContext,
  e: Entity,
  need: DraughtNeed,
): number | null {
  const eq = world.tryGet(e, Equipment);
  if (eq === undefined) return null;
  const goods = contentIndex(ctx.content).goods;
  let broad: number | null = null;
  for (let slot = 0; slot < eq.misc.length; slot++) {
    const held = eq.misc[slot];
    if (held == null || held.degreeOfUse >= ONE) continue;
    const restore = goods.get(held.goodType)?.equip?.restorePct;
    if (restore?.[need] === undefined) continue;
    const dedicated =
      (need === 'hunger' ? restore.fatigue : restore.hunger) === undefined && restore.healthMax === undefined;
    if (dedicated) return slot;
    if (broad === null) broad = slot;
  }
  return broad;
}

/** Start the in-place drink: the eat gesture (no decoded drink clip exists - named approximation)
 *  over the shared eat duration, completing into the `drink` effect on the chosen slot. */
export function startDrink(
  world: World,
  ctx: SystemContext,
  e: Entity,
  settler: SettlerIdentity,
  slot: number,
): void {
  startAtomic(world, e, EAT_ATOMIC_ID, { kind: 'drink', slot }, eatDuration(ctx, settler), e);
}
