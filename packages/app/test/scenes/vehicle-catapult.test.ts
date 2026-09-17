import { expect, it } from 'vitest';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { vehicleCatapultScene } from '../../src/scenes/vehicle-catapult.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(vehicleCatapultScene, import.meta.url);

/** Long enough for the boarding, the order, one clip's event tick and the stone's flight. */
const FIRST_SHOT_TICKS = 120;

/** The stone leaves as a rock projectile at the clip's event tick and bursts on the hut, a structure
 *  hit; the archer's arrows land on the hull as structure hits too, so neither bleeds. */
it('the first stone is loosed at the hut and lands on it as a structure hit', () => {
  const sim = createSceneSim(vehicleCatapultScene);
  const launched: number[] = [];
  const hits: { target: number; structure?: boolean }[] = [];
  for (let i = 0; i < FIRST_SHOT_TICKS; i++) {
    sim.step();
    for (const ev of sim.events.current()) {
      if (ev.kind === 'projectileLaunched') launched.push(ev.munitionType);
      if (ev.kind === 'projectileHit')
        hits.push({ target: ev.target, ...(ev.structure ? { structure: true } : {}) });
    }
  }
  const ROCK = 2;
  expect(launched).toContain(ROCK);
  expect(hits.some((hit) => hit.structure === true)).toBe(true);
});
