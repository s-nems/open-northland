import type { RoomSettings } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { restoreSimulation } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { testContent } from '../../../../sim/test/fixtures/content.js';
import { map, world } from '../../support/army-world.js';
import { HeadlessClient } from '../../support/headless-client.js';
import { assembleRoom, runFor, runUntil, type Stage } from '../../support/session-run.js';
import { seededRandom, VirtualClock, VirtualNetwork } from '../../support/virtual-network.js';

const SETTINGS: RoomSettings = {
  name: 'donor',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 7,
  rules: {
    fog: null,
    progression: null,
    needs: null,
    weather: null,
    dayNight: null,
    alliedVision: null,
    peace: null,
  },
  speed: 1,
};
/** Long enough for the smoothed trips and the reserve to settle before the upload. */
const WARM_UP_MS = 20_000;
const WATCH_SECONDS = 30;
/** The army world's snapshot holds Ania's pongs back for about five seconds on this uplink. */
const DONOR_UPLINK_BYTES_PER_SECOND = 7000;

function client(nick: string): HeadlessClient {
  return new HeadlessClient({
    token: `${nick.toLowerCase()}-donor-0123456789`,
    nick,
    buildWorld: async () => world(),
    restoreWorld: async (_session, save) => restoreSimulation(save, { content: testContent(), map }),
  });
}

it('does not inflate a snapshot donor’s input delay or the room reserve beyond a tick', async () => {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(5)) };
  const [ania, bartek, cezary] = [client('Ania'), client('Bartek'), client('Cezary')];
  const clients = [ania, bartek, cezary];
  // Ania has the best round trip, so the relay asks her for the snapshot.
  stage.network.link(ania, {
    latencyMs: 40,
    jitterMs: 5,
    uploadBytesPerSecond: DONOR_UPLINK_BYTES_PER_SECOND,
  });
  stage.network.link(bartek, { latencyMs: 120, jitterMs: 20 });
  stage.network.link(cezary, { latencyMs: 150, jitterMs: 20 });
  await assembleRoom(stage, clients, {
    settings: SETTINGS,
    seats: [0, 1, 2].map((player) => ({
      player,
      mode: 'idle',
      claimable: true,
      offers: ['idle'],
      color: player,
    })),
    seatOf: (index) => index,
    settleMs: 1500,
  });
  await runFor(stage, clients, WARM_UP_MS);
  const steadyDelay = ania.delayTicks ?? Number.NaN;
  const steadyReserve = bartek.responsiveness.bufferTicks;
  const splitAt = (cezary.tick ?? 0) + 1;
  await runUntil(stage, clients, splitAt + 1, {
    onTick: (c, tick) => {
      if (c === cezary && tick === splitAt && c.sim !== null) c.sim.rng.setState(c.sim.rng.getState() ^ 1);
    },
  });
  const rows: string[] = [];
  let peakDelay = steadyDelay;
  let peakReserve = steadyReserve;
  for (let second = 0; second < WATCH_SECONDS; second++) {
    await runFor(stage, clients, 1000);
    peakDelay = Math.max(peakDelay, ania.delayTicks ?? 0);
    peakReserve = Math.max(peakReserve, bartek.responsiveness.bufferTicks);
    rows.push(`${second}s delay=${ania.delayTicks} reserve=${bartek.responsiveness.bufferTicks}`);
  }
  const trace = `steady delay=${steadyDelay} reserve=${steadyReserve}\n${rows.join('\n')}`;
  expect(cezary.restoredFrom.length, trace).toBeGreaterThan(0);
  expect(peakDelay, trace).toBe(steadyDelay);
  expect(peakReserve, trace).toBeLessThanOrEqual(steadyReserve + 1);
  expect(ania.delayTicks, trace).toBeLessThanOrEqual(steadyDelay);
  expect(bartek.responsiveness.bufferTicks, trace).toBe(steadyReserve);
});
