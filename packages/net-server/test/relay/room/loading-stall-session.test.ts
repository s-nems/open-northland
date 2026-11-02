import type { DepartedSeatMode, RoomSettings } from '@open-northland/net-protocol';
import { LOADING_STALL_MS, Relay } from '@open-northland/net-server';
import type { Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HeadlessClient } from '../../support/headless-client.js';
import { relink, runFor, runUntil, type Stage, settle } from '../../support/session-run.js';
import { buildTestWorld, restoreTestWorld } from '../../support/test-world.js';
import { type Link, seededRandom, VirtualClock, VirtualNetwork } from '../../support/virtual-network.js';

/**
 * Real sims on the relay while one player's boot never moves, as a tab frozen through its load does:
 * the others start without it once `LOADING_STALL_MS` has passed, and its seat follows the room's
 * `kickedSeatMode`.
 */

const SETTINGS: RoomSettings = {
  name: 'fixture',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 5,
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
const SEATS = [0, 1, 2].map((player) => ({
  player,
  mode: 'idle' as const,
  claimable: true,
  offers: ['idle', 'computer', 'absent'] as const,
  color: player,
}));
const LINK = { latencyMs: 60, jitterMs: 20 };
/** Time for a lobby step or a reconnect to cross the link and back, with margin. */
const SETTLE_MS = 400;
const RUN_TICKS = 40;

/** A boot that never finishes and never reports progress. */
const frozenBuild = (): Promise<Simulation> => new Promise(() => undefined);

function client(nick: string, build = buildTestWorld): HeadlessClient {
  return new HeadlessClient({
    token: `${nick.toLowerCase()}-token-0123456789`,
    nick,
    buildWorld: build,
    restoreWorld: restoreTestWorld,
  });
}

function stageFor(seed: number): Stage {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  return { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(seed)) };
}

/** Every client in seat by its index, the last one booting forever; resolves once the others built. */
async function startWithFrozenLast(nicks: readonly string[], kickedSeatMode: DepartedSeatMode) {
  const stage = stageFor(nicks.length);
  const healthy = nicks.slice(0, -1).map((nick) => client(nick));
  const frozen = client(nicks.at(-1) ?? 'Zenon', frozenBuild);
  const everyone = [...healthy, frozen];
  const links = new Map<HeadlessClient, Link>(everyone.map((each) => [each, stage.network.link(each, LINK)]));
  const [host, ...guests] = everyone;
  if (host === undefined) throw new Error('a room needs a creator');
  for (const each of everyone) each.hello();
  settle(stage, SETTLE_MS);
  host.createRoom({ ...SETTINGS, kickedSeatMode }, SEATS.slice(0, everyone.length));
  settle(stage, SETTLE_MS);
  const roomId = host.room?.id ?? '';
  for (const guest of guests) guest.joinRoom(roomId);
  settle(stage, SETTLE_MS);
  everyone.forEach((each, seat) => {
    each.claimSeat(seat);
  });
  settle(stage, SETTLE_MS);
  for (const each of everyone) each.setReady(true);
  settle(stage, SETTLE_MS);
  host.start();
  await runFor(stage, healthy, SETTLE_MS);
  return { stage, healthy, frozen, link: (each: HeadlessClient) => links.get(each) };
}

describe('a player whose boot never moves', () => {
  it.each(['computer', 'idle'] as const)(
    'is handed over to %s in a room of three, and the other two start together',
    async (mode) => {
      const { stage, healthy, frozen } = await startWithFrozenLast(['Ania', 'Bartek', 'Cezary'], mode);
      const [ania] = healthy;
      await runFor(stage, healthy, LOADING_STALL_MS - SETTLE_MS * 2);
      expect(ania?.kicks).toEqual([]);
      expect(ania?.clockNotices).toEqual([]);
      await runFor(stage, healthy, SETTLE_MS * 2);
      const kicked = { kind: 'kicked', player: 2, nick: 'Cezary', mode, cause: 'loadingTimedOut' };
      for (const each of [...healthy, frozen]) expect(each.kicks, each.nick).toMatchObject([kicked]);
      expect(frozen.room).toBeNull();
      expect(ania?.room?.seats[2]).toMatchObject({ mode, nick: null });
      const captures = await runUntil(stage, healthy, RUN_TICKS);
      const hashes = healthy.map((each) => captures.get(each)?.hash);
      expect(new Set(hashes).size).toBe(1);
      for (const each of healthy) expect(each.errors, each.nick).toEqual([]);
    },
  );

  it('leaves the one other player to start alone', async () => {
    const { stage, healthy, frozen } = await startWithFrozenLast(['Ania', 'Bartek'], 'idle');
    await runFor(stage, healthy, LOADING_STALL_MS);
    const [ania] = healthy;
    expect(ania?.kicks).toMatchObject([{ nick: 'Bartek', cause: 'loadingTimedOut', mode: 'idle' }]);
    expect(frozen.kicks).toHaveLength(1);
    const captures = await runUntil(stage, healthy, RUN_TICKS);
    expect(captures.get(ania ?? frozen)?.hash).toBeDefined();
    expect(ania?.errors).toEqual([]);
  });

  it('tells a frozen player that returns on a new socket after the handover that it was kicked, once', async () => {
    const { stage, healthy, frozen, link } = await startWithFrozenLast(
      ['Ania', 'Bartek', 'Cezary'],
      'computer',
    );
    // The host closes a socket that stays silent; the stall counts from that drop.
    link(frozen)?.close();
    await runFor(stage, healthy, LOADING_STALL_MS + SETTLE_MS);
    expect(healthy[0]?.kicks).toMatchObject([{ nick: 'Cezary', cause: 'loadingTimedOut' }]);
    expect(frozen.kicks).toEqual([]);
    relink(stage, frozen, LINK);
    await runFor(stage, healthy, SETTLE_MS * 4);
    expect(frozen.kicks).toMatchObject([{ nick: 'Cezary', player: 2, cause: 'loadingTimedOut' }]);
    expect(frozen.session).toBeNull();
    expect(frozen.room).toBeNull();
    expect(frozen.rejections).toEqual([]);
    const captures = await runUntil(stage, healthy, RUN_TICKS);
    expect(new Set(healthy.map((each) => captures.get(each)?.hash)).size).toBe(1);
    expect(frozen.kicks).toHaveLength(1);
  });
});
