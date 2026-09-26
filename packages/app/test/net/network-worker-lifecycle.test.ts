import { expect, it } from 'vitest';
import { deliveredMatchEnd } from '../../src/net/net-worker-client.js';

const ENDED_TICK = 50;

it('reports the confirmed match end only once the runtime delivered its tick', () => {
  const client = { endedTick: ENDED_TICK };
  expect(deliveredMatchEnd(client, { tick: ENDED_TICK - 2 })).toBeNull();
  expect(deliveredMatchEnd(client, { tick: ENDED_TICK })).toBe(ENDED_TICK);
  expect(deliveredMatchEnd({ endedTick: null }, { tick: ENDED_TICK })).toBeNull();
});
