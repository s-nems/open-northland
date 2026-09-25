import type { EquipRestorePct } from '@open-northland/data';
import { Equipment, Health } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { applyEquipWear, wearStepOf } from './wear.js';

// Carried draughts (mead, potions, the food and stamina amulets) are drunk on the spot, with no clip and
// no walk: one sip applies its restore and spends one rated use, or nothing for an amulet. Original
// behavior.

/** The bar a draught restores, keyed like the content's `restorePct`. */
type DraughtNeed = keyof EquipRestorePct;

/** Owner's rule, departing from the original's sip-only-at-death save: a wound that would leave the
 *  bearer under this percent of its max hitpoints is softened by healing draughts. */
const HEALING_DRAUGHT_BELOW_PCT = 50;

interface CarriedDraught {
  readonly slot: number;
  readonly restore: EquipRestorePct;
}

/** Where a carried draught ranks: opened, permanent (an amulet), then rated uses. */
interface DraughtRank {
  readonly opened: boolean;
  readonly permanent: boolean;
  readonly uses: number;
}

function outranks(a: DraughtRank, b: DraughtRank): boolean {
  if (a.opened !== b.opened) return a.opened;
  if (a.permanent !== b.permanent) return a.permanent;
  return a.uses < b.uses;
}

/**
 * The carried draught to drink for `need`, or null. Original behavior: an opened bottle goes before an
 * amulet, an amulet before a full bottle, then the one with fewer rated uses (small before large, mead
 * counting as small), then the lowest slot.
 */
export function draughtFor(
  world: World,
  ctx: SystemContext,
  e: Entity,
  need: DraughtNeed,
): CarriedDraught | null {
  const eq = world.tryGet(e, Equipment);
  if (eq === undefined) return null;
  const goods = contentIndex(ctx.content).goods;
  let best: (CarriedDraught & DraughtRank) | null = null;
  for (let slot = 0; slot < eq.misc.length; slot++) {
    const held = eq.misc[slot] ?? null;
    if (held === null || held.degreeOfUse >= ONE) continue;
    const equip = goods.get(held.goodType)?.equip;
    const restore = equip?.restorePct;
    if (restore?.[need] === undefined) continue;
    const rank: DraughtRank = {
      opened: held.degreeOfUse > ZERO,
      permanent: !equip?.wears,
      uses: equip?.uses ?? 0,
    };
    if (best === null || outranks(rank, best)) best = { slot, restore, ...rank };
  }
  return best === null ? null : { slot: best.slot, restore: best.restore };
}

/** Spend one sip of the draught in misc `slot`; the last one empties the slot, and an amulet never wears. */
export function spendSip(world: World, ctx: SystemContext, e: Entity, slot: number): void {
  const held = world.get(e, Equipment).misc[slot];
  if (held != null) applyEquipWear(world, e, 'misc', slot, wearStepOf(ctx, held.goodType));
}

/**
 * Take `damage` off a bearer's hitpoints. While the wound would leave it under
 * {@link HEALING_DRAUGHT_BELOW_PCT} of its max, it drinks healing sips first, so a blow that would kill
 * is survived when the carried sips cover it. Hitpoints a temple raised above the max stay until the
 * damage takes them.
 */
export function woundBearer(world: World, ctx: SystemContext, e: Entity, damage: number): void {
  const health = world.get(e, Health);
  let hitpoints = health.hitpoints - damage;
  while (hitpoints * 100 < health.max * HEALING_DRAUGHT_BELOW_PCT) {
    const draught = draughtFor(world, ctx, e, 'healthMax');
    if (draught?.restore.healthMax === undefined) break;
    hitpoints += Math.trunc((health.max * draught.restore.healthMax) / 100);
    spendSip(world, ctx, e, draught.slot);
  }
  world.mut(e, Health).hitpoints = Math.max(0, Math.min(Math.max(health.max, health.hitpoints), hitpoints));
}
