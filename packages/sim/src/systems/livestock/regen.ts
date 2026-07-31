import { Health, Livestock, Owner } from '../../components/index.js';
import type { System } from '../context.js';

/** HP a claimed animal regrows per tick. Approximated (no readable constant), calibrated so ~3 animals
 *  sustain a farm's 2 breeders: two feed cycles per 180-tick window drain 500 HP while three animals
 *  regrow 540. Wild animals do not regenerate (named approximation - only penned stock is observed
 *  recovering fast in the original). */
export const LIVESTOCK_REGEN_HP_PER_TICK = 1;

/**
 * LivestockRegenSystem - claimed livestock heals back the life that processing visits drain. Only an
 * OWNED {@link Livestock} creature regenerates, up to its pool cap; per-entity independent writes, so
 * raw query order cannot change the result.
 */
export const livestockRegenSystem: System = (world, _ctx) => {
  for (const e of world.query(Livestock, Owner, Health)) {
    const h = world.get(e, Health);
    if (h.hitpoints <= 0 || h.hitpoints >= h.max) continue;
    world.write(e, Health, (v) => {
      v.hitpoints = Math.min(v.max, v.hitpoints + LIVESTOCK_REGEN_HP_PER_TICK);
    });
  }
};
