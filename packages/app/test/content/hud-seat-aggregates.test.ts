import { existsSync } from 'node:fs';
import { buildHud } from '@open-northland/render';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapPath, realMapWorld } from './real-map-world.js';

const { Owner, Person, Settler } = components;

/** A decoded map whose human seat fields four tribes and no vikings - the case a tribe-keyed HUD reads
 *  as an empty settlement while the seat commands a few hundred units. */
const MAP_ID = 'gringo_sub';
const HUMAN_SEAT = 0;

/**
 * The HUD aggregates against a REAL decoded roster. A seat is routinely multi-tribe and a tribe routinely
 * spans seats, so only `Owner.player` answers "what do I command"; the synthetic fixtures in
 * `render/test/hud.test.ts` can state that rule but not that decoded content actually exercises it.
 */
describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))('the HUD over a decoded seat', () => {
  it('counts the whole multi-tribe seat, which no single tribe id covers', async () => {
    const { sim } = await realMapWorld({ mapId: MAP_ID, aiSeats: [] });

    let peopleOnSeat = 0;
    const tribesOnSeat = new Set<number>();
    const tribesOnOtherSeats = new Set<number>();
    for (const e of sim.world.query(Person, Settler)) {
      const tribe = sim.world.get(e, Settler).tribe;
      const owner = sim.world.tryGet(e, Owner)?.player;
      if (owner === HUMAN_SEAT) {
        peopleOnSeat++;
        tribesOnSeat.add(tribe);
      } else if (owner !== undefined) {
        tribesOnOtherSeats.add(tribe);
      }
    }
    // The premises. Without both, the map cannot show either way a tribe-keyed readout misses: no
    // single tribe covers the seat, and keying on a shared tribe would count another seat's units too.
    expect(tribesOnSeat.size).toBeGreaterThan(1);
    expect([...tribesOnSeat].some((t) => tribesOnOtherSeats.has(t))).toBe(true);

    const hud = buildHud(sim.snapshot(), HUMAN_SEAT);
    expect(hud.player).toBe(HUMAN_SEAT);
    expect(hud.population).toBe(peopleOnSeat);
  });
});
