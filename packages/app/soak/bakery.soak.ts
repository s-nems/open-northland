import { existsSync } from 'node:fs';
import { components } from '@open-northland/sim';
import { describe, it } from 'vitest';
import { hasRealIr, rawIrUnderTest } from '../test/content/helpers.js';
import { realMapPath, realMapWorld } from '../test/content/real-map-world.js';
import { intEnv } from './knobs.js';

const { Building, Owner, Stockpile } = components;

/**
 * The workshop-throughput soak — `npm run soak:bakery`. It runs the browser session
 * `?map=magiczny_las&ai=0,1,2,3,4,5` headless and reports, per settlement, how much of each DISH is
 * sitting on a producer's shelf against how much banked as an edible. A dish parked at its shelf cap is
 * a wedged workshop: nothing can be made until a unit leaves. Like the gatherer soak this is a
 * diagnostic, not a gate — `*.soak.ts` matches no other vitest config, which keeps a 20k-tick run out of
 * `npm test` and CI. Knob: `ON_SOAK_TICKS`.
 *
 * Baseline for docs/tickets/sim/bakery-p5-still-capped.md: per-seat bread 0/0/6/0/5/19 at tick 20 000.
 */

const MAP_ID = 'magiczny_las';
const AI_SEATS = [0, 1, 2, 3, 4, 5];
const TICKS = intEnv('ON_SOAK_TICKS', 20_000, 1);

describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))('bakery throughput', () => {
  it('reports dish and edible stocks across the settlement', { timeout: 60 * 60_000 }, async () => {
    const { sim } = await realMapWorld({ mapId: MAP_ID, aiSeats: AI_SEATS, berryBushes: true });
    const ir = rawIrUnderTest() as {
      goods: Array<{ typeId: number; id: string }>;
      buildings: Array<{ typeId: number; id: string }>;
    };
    const good = (id: string) => ir.goods.find((g) => g.id === id)?.typeId ?? -1;
    const BREAD = good('bread');
    const FOOD_SIMPLE = good('food_simple');
    const FOOD_EXTRA = good('food_extra');
    const nameOf = new Map(ir.buildings.map((b) => [b.typeId, b.id]));

    sim.run(TICKS);

    const rows: string[] = [];
    let totalFood = 0;
    for (const e of sim.world.query(Building, Owner, Stockpile)) {
      const id = nameOf.get(sim.world.get(e, Building).buildingType) ?? '?';
      const amounts = sim.world.get(e, Stockpile).amounts;
      const bread = amounts.get(BREAD) ?? 0;
      const simple = amounts.get(FOOD_SIMPLE) ?? 0;
      const extra = amounts.get(FOOD_EXTRA) ?? 0;
      totalFood += simple + extra;
      if (bread === 0 && simple === 0 && extra === 0) continue;
      rows.push(
        `p${sim.world.get(e, Owner).player} ${id.padEnd(20)} bread=${String(bread).padStart(3)} food_simple=${String(simple).padStart(4)} food_extra=${String(extra).padStart(4)}`,
      );
    }
    console.log(`\n=== tick ${TICKS} (total banked food: ${totalFood}) ===\n${rows.sort().join('\n')}\n`);
  });
});
