import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { coinDrillCoinsOf, coinDrillPointsOf, coinDrillServedTicksOf } from '../../../src/game/coin-drill.js';
import { hasRealIr, loadContentUnderTest } from '../helpers.js';

const NO_POINTS: ReadonlyMap<number, number> = new Map();
/** The shipped clip's events: `CHANGE_GOLD -1` and `GET_TRAINING 25`. */
const COINS_PER_TERM = 1;
const POINTS_PER_TERM = 25;
const CLIP_TICKS = 28;

/**
 * The coin drill's clip join over the real IR: each playable tribe binds its `..._soldier_train` clip to the
 * bare soldier alone, so he must resolve it on his own trade and every armed trade through its base job.
 */
describe.runIf(hasRealIr())('coin drill over the real IR', () => {
  it('lets every soldier trade of every drilling tribe, the bare one included, drill for a coin', async () => {
    const { real } = await loadContentUnderTest();
    const tribes = real.tribes.filter((tribe) =>
      tribe.atomicBindings.some((binding) => binding.atomicId === systems.COIN_DRILL_ATOMIC_ID),
    );
    const soldiers = real.jobs.filter((job) => systems.isSoldierJob(real, job.typeId));
    expect(tribes.length).toBeGreaterThan(0);
    expect(soldiers.length).toBeGreaterThan(1);
    for (const tribe of tribes) {
      for (const job of soldiers) {
        const settler = { tribe: tribe.typeId, jobType: job.typeId };
        expect(systems.mayCoinDrill(real, settler, undefined, NO_POINTS), `${tribe.id} ${job.id}`).toBe(true);
      }
    }
  });

  it('states what the knowledge base shows: one coin, its points and the served term', async () => {
    const { real } = await loadContentUnderTest();
    expect(coinDrillCoinsOf(real)).toBe(COINS_PER_TERM);
    expect(coinDrillPointsOf(real)).toBe(POINTS_PER_TERM);
    expect(coinDrillServedTicksOf(real)).toBe(
      Math.ceil(systems.COIN_DRILL_TERM_TICKS / CLIP_TICKS) * CLIP_TICKS,
    );
  });
});
