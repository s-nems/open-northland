import { TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

/**
 * The story map's prologue sends its three heroes to one spot under the headquarters' walk block and
 * waits for the last of them within one node of it. A spot that hands every hero the same stand-in
 * queues the last one out of range, and the prologue never ends.
 */
const MAP_ID = 'mroczny_swiat_sub1';
/** The script's own timers and walks end the prologue a little under four minutes in. */
const PROLOGUE_BUDGET_TICKS = 5 * 60 * TICKS_PER_SECOND;

describe.runIf(hasRealIr())(`${MAP_ID}: the prologue`, () => {
  it('runs every mission and hands back to the main map', async () => {
    const { sim } = await realMapWorld({ mapId: MAP_ID, aiSeats: [] });
    let ended = false;
    for (let tick = 0; tick < PROLOGUE_BUDGET_TICKS && !ended; tick++) {
      sim.step();
      ended = sim.events.current().some((e) => e.kind === 'missionSubMission' && e.transition.kind === 'end');
    }
    expect(sim.missionStatus().filter((m) => !m.done)).toEqual([]);
    expect(ended).toBe(true);
  }, 300_000);
});
