import { Health, Livestock, Owner } from '../../components/index.js';
import type { System } from '../context.js';

/** Ticks between regen pulses. Approximated (no readable constant), paced with {@link LIVESTOCK_REGEN_HP}
 *  so a visit's 250-HP drain regrows in 750 ticks: slow enough to keep the drained heart readable, fast
 *  enough that ~3 animals of a species sustain its feed chain (the measured batch rhythm drains ~0.8
 *  HP/tick, three animals regrow 1). */
export const LIVESTOCK_REGEN_PERIOD_TICKS = 3;

/** HP a claimed animal regrows per pulse. Wild animals do not regenerate (named approximation - only
 *  penned stock is observed recovering in the original). */
export const LIVESTOCK_REGEN_HP = 1;

/**
 * Claimed livestock heals back the life that processing visits drain, up to its pool cap. Only an owned
 * {@link Livestock} creature regenerates; per-entity independent writes, so raw query order cannot change
 * the result.
 */
export const livestockRegenSystem: System = (world, ctx) => {
  if (ctx.tick % LIVESTOCK_REGEN_PERIOD_TICKS !== 0) return;
  for (const e of world.query(Livestock, Owner, Health)) {
    const h = world.get(e, Health);
    if (h.hitpoints <= 0 || h.hitpoints >= h.max) continue;
    world.mut(e, Health).hitpoints = Math.min(h.max, h.hitpoints + LIVESTOCK_REGEN_HP);
  }
};
