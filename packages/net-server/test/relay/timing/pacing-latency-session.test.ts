import type { GameSession } from '@open-northland/lockstep';
import { type ResponsivenessMode, type RoomSettings, TICK_MS } from '@open-northland/net-protocol';
import { LAG_BEHIND_MS, Relay, SLOW_GRACE_MS } from '@open-northland/net-server';
import { Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../../../sim/test/fixtures/content.js';
import { framesIn, SLOW_WAIT_AFTER_MS } from '../../../src/relay/timing/governor.js';
import { HeadlessClient } from '../../support/headless-client.js';
import { assembleRoom, runFor, runUntil, type Stage } from '../../support/session-run.js';
import { restoreTestWorld } from '../../support/test-world.js';
import { seededRandom, VirtualClock, VirtualNetwork } from '../../support/virtual-network.js';

/** Pacing judges how far a member trails beyond what its link and the room's reserve put in flight:
 *  a member on another continent is no slower than one next door. */

const SETTINGS: RoomSettings = {
  name: 'far',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 9,
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
const SEATS = [0, 1].map((player) => ({
  player,
  mode: 'idle' as const,
  claimable: true,
  offers: ['idle' as const],
  color: player,
}));
const NEAR_LINK = { latencyMs: 40, jitterMs: 10 };
/** A trip between continents. */
const FAR_LINK = { latencyMs: 450, jitterMs: 40 };
const SETTLE_MS = 1000;
/** The automatic reserve, and the manual ones that hold a member's acknowledgements further back. */
const MODES: readonly ResponsivenessMode[] = ['auto', 'balanced', 'smooth'];
const WARM_UP_TICKS = 60;
const PLAY_MS = 2 * 60_000;
/** A stall long enough to make the member slow at once. */
const STALL_MS = LAG_BEHIND_MS + SLOW_GRACE_MS * 2;
/** Wall time a stalled member gets to catch up and be released. */
const RECOVERY_MS = 10_000;

async function farRoom(mode: ResponsivenessMode) {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(31)) };
  const client = (nick: string) =>
    new HeadlessClient({
      token: `far-${nick}-0123456789abcdef`,
      nick,
      now: clock.now,
      buildWorld: async (session: GameSession) =>
        new Simulation({ seed: session.seed, content: testContent() }),
      restoreWorld: restoreTestWorld,
    });
  const ania = client('Ania');
  const bartek = client('Bartek');
  stage.network.link(ania, NEAR_LINK);
  stage.network.link(bartek, FAR_LINK);
  await assembleRoom(stage, [ania, bartek], {
    settings: SETTINGS,
    seats: SEATS,
    seatOf: (i) => i,
    settleMs: SETTLE_MS,
  });
  ania.setResponsiveness(mode);
  await runUntil(stage, [ania, bartek], WARM_UP_TICKS);
  return { stage, ania, bartek };
}

const governedNicks = (client: HeadlessClient): (string | null)[] =>
  client.clockNotices.map((notice) => notice.governed?.nick ?? null);
const waitedSince = (client: HeadlessClient, from: number): string[] =>
  client.waits.slice(from).flatMap((wait) => wait.for.map((member) => `${member.nick}:${member.reason}`));

describe('a member on a far link', () => {
  it.each(MODES)('is never slow or waited for over two minutes of play, responsiveness %s', async (mode) => {
    const { stage, ania, bartek } = await farRoom(mode);
    const from = ania.clockNotices.length;
    const waitsFrom = ania.waits.length;
    const startTick = ania.tick ?? 0;
    await runFor(stage, [ania, bartek], PLAY_MS);
    expect(
      governedNicks(ania)
        .slice(from)
        .filter((nick) => nick !== null),
    ).toEqual([]);
    expect(ania.governed).toBeNull();
    expect(waitedSince(ania, waitsFrom)).toEqual([]);
    expect(bartek.dropped).toEqual([]);
    // It kept up: every tick of the run but those a lag's worth of frames would hold back.
    expect((bartek.tick ?? 0) - startTick).toBeGreaterThan(
      PLAY_MS / TICK_MS - framesIn(LAG_BEHIND_MS, SETTINGS.speed),
    );
    expect(bartek.responsiveness.mode).toBe(mode);
  });

  it.each(MODES)(
    'is released once it has caught up after a stall, and never waited for as slow, responsiveness %s',
    async (mode) => {
      const { stage, ania, bartek } = await farRoom(mode);
      const waitsFrom = ania.waits.length;
      await runFor(stage, [ania], STALL_MS);
      expect(ania.governed).toMatchObject({ nick: 'Bartek' });
      await runFor(stage, [ania, bartek], RECOVERY_MS);
      expect(ania.governed).toBeNull();
      await runFor(stage, [ania, bartek], SLOW_WAIT_AFTER_MS * 2);
      expect(ania.governed).toBeNull();
      expect(waitedSince(ania, waitsFrom)).toEqual([]);
    },
  );
});
