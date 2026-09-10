import { components, TICKS_PER_SECOND as SIM_TICKS_PER_SECOND } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { MAX_SEATS, TICKS_PER_SECOND } from '../src/index.js';

/** The protocol repeats two of the sim's numbers rather than importing them, so that the relay never
 *  loads the sim; this is where the copies are held to the originals. */
it('carries the same tick rate and seat count as the sim', () => {
  expect(TICKS_PER_SECOND).toBe(SIM_TICKS_PER_SECOND);
  expect(MAX_SEATS).toBe(components.MAX_PLAYERS);
});
