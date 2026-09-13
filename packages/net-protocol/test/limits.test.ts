import {
  COMMAND_ENVELOPE_VERSION,
  components,
  FOG_MODE,
  SYNC_DOMAINS as SIM_SYNC_DOMAINS,
  TICKS_PER_SECOND as SIM_TICKS_PER_SECOND,
} from '@open-northland/sim';
import { expect, it } from 'vitest';
import { ENVELOPE_VERSION, FOG_MODES, MAX_SEATS, SYNC_DOMAINS, TICKS_PER_SECOND } from '../src/index.js';

/** The protocol repeats a few of the sim's numbers and names rather than importing them, so that the
 *  relay never loads the sim; this is where the copies are held to the originals. */
it('carries the same tick rate, seat count, envelope version, digest domains and fog modes as the sim', () => {
  expect(TICKS_PER_SECOND).toBe(SIM_TICKS_PER_SECOND);
  expect(MAX_SEATS).toBe(components.MAX_PLAYERS);
  expect(ENVELOPE_VERSION).toBe(COMMAND_ENVELOPE_VERSION);
  expect([...SYNC_DOMAINS].sort()).toEqual([...SIM_SYNC_DOMAINS].sort());
  expect([...FOG_MODES].sort()).toEqual(Object.values(FOG_MODE).sort());
});
