import type { GameSession } from '@open-northland/lockstep';
import { encodeSnapshot } from '@open-northland/net-client';
import type { RoomSettings } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { components, exportSaveGame, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { RETURN_SNAPSHOT_MAX_TICKS } from '../../../src/relay/snapshots/resync.js';
import { HeadlessClient } from '../../support/headless-client.js';
import {
  assembleRoom,
  type Capture,
  relink,
  runFor,
  runUntil,
  type Stage,
} from '../../support/session-run.js';
import { buildTestWorld, restoreTestWorld } from '../../support/test-world.js';
import {
  type LinkOptions,
  seededRandom,
  VirtualClock,
  VirtualNetwork,
} from '../../support/virtual-network.js';

/** A player reloads its page mid-game: it comes back with no world and is served one by the relay. */

const SETTINGS: RoomSettings = {
  name: 'fixture',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 11,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
const SEATS = [0, 1].map((player) => ({
  player,
  mode: 'idle' as const,
  claimable: true,
  offers: ['idle' as const, 'computer' as const],
  color: player,
}));
const LINK: LinkOptions = { latencyMs: 60, jitterMs: 10 };
const SETTLE_MS = 400;
const CACHED_AT_TICK = 30;
/** Ticks of play past the replay bound before the reload. */
const MARGIN_TICKS = 24;
const RUN_ON_TICKS = 60;
/** A slow home downlink. */
const SLOW_DOWNLINK_BYTES_PER_SECOND = 16 * 1024;
/** Characters of seeded noise one settler's name carries: gzip leaves about three quarters of them,
 *  and base64 brings the snapshot back to about this many bytes. */
const NOISE_CHARACTERS = 1024 * 1024;
const NOISE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MEGABYTE = 1_000_000;
/** Virtual time for the whole snapshot to cross the slow downlink, with margin. */
const SLOW_DOWNLOAD_MS = ((NOISE_CHARACTERS * 2) / SLOW_DOWNLINK_BYTES_PER_SECOND) * 1000;

/** The fixture world with a name no compression shrinks, so its snapshot is about a megabyte. */
async function buildHeavyWorld(session: GameSession): Promise<Simulation> {
  const sim = await buildTestWorld(session);
  const random = seededRandom(session.seed);
  let name = '';
  for (let i = 0; i < NOISE_CHARACTERS; i++)
    name += NOISE_ALPHABET[Math.floor(random() * NOISE_ALPHABET.length)];
  sim.world.add(sim.world.create(), components.ScriptedLook, { recipes: [name] });
  return sim;
}

function client(nick: string, build: typeof buildTestWorld): HeadlessClient {
  return new HeadlessClient({
    token: `${nick.toLowerCase()}-token-0123456789`,
    nick,
    buildWorld: build,
    restoreWorld: restoreTestWorld,
  });
}

/** Ania and Bartek in a running room, with the relay's cache taken from Ania's world at `CACHED_AT_TICK`. */
async function cachedRoom(seed: number, build: typeof buildTestWorld) {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  const stage: Stage = { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(seed)) };
  const ania = client('Ania', build);
  const bartek = client('Bartek', build);
  const links = [stage.network.link(ania, LINK), stage.network.link(bartek, LINK)] as const;
  await assembleRoom(stage, [ania, bartek], {
    settings: SETTINGS,
    seats: SEATS,
    seatOf: (i) => i,
    settleMs: SETTLE_MS,
  });
  await runUntil(stage, [ania, bartek], CACHED_AT_TICK);
  ania.receive({ kind: 'snapshotRequest' });
  await ania.settled();
  await runFor(stage, [ania, bartek], SETTLE_MS);
  return { stage, ania, bartek, links };
}

/** Bartek's page reloads: the old link closes and a new client with the same token and no world takes over. */
function reload(
  stage: Stage,
  link: { close(): void },
  options: LinkOptions,
  build: typeof buildTestWorld,
): HeadlessClient {
  link.close();
  const again = client('Bartek', build);
  relink(stage, again, options);
  return again;
}

function expectAgreement(captures: Map<HeadlessClient, Capture>, clients: readonly HeadlessClient[]): void {
  const [first, ...rest] = clients;
  for (const other of rest)
    expect(captures.get(other)?.hash, other.nick).toBe(captures.get(first ?? other)?.hash);
  for (const each of clients) {
    expect(each.dropped, each.nick).toEqual([]);
    expect(each.rejections, each.nick).toEqual([]);
  }
}

function silentNicks(observer: HeadlessClient): string[] {
  return observer.waits.flatMap((notice) =>
    notice.for.filter((member) => member.reason === 'silent').map((member) => member.nick),
  );
}

describe('a reloaded page in a running game', () => {
  it('restores from a fresh snapshot when the cache is further behind than it replays', async () => {
    const { stage, ania, links } = await cachedRoom(3, buildTestWorld);
    const reloadAt = CACHED_AT_TICK + RETURN_SNAPSHOT_MAX_TICKS + MARGIN_TICKS;
    await runUntil(stage, [ania], reloadAt);
    const again = reload(stage, links[1], LINK, buildTestWorld);
    await runFor(stage, [ania, again], SETTLE_MS * 2);

    expect(again.restoredFrom).toHaveLength(1);
    expect(again.restoredFrom[0]).toBeGreaterThanOrEqual(reloadAt);
    const captures = await runUntil(stage, [ania, again], reloadAt + RUN_ON_TICKS);
    expectAgreement(captures, [ania, again]);
  });

  it('never waits for a client as silent while it downloads a megabyte snapshot over a slow link', async () => {
    const { stage, ania, links } = await cachedRoom(4, buildHeavyWorld);
    if (ania.sim === null) throw new Error('Ania holds no world');
    expect((await encodeSnapshot(exportSaveGame(ania.sim))).length).toBeGreaterThan(MEGABYTE);
    const again = reload(
      stage,
      links[1],
      { ...LINK, downloadBytesPerSecond: SLOW_DOWNLINK_BYTES_PER_SECOND },
      buildHeavyWorld,
    );
    await runFor(stage, [ania, again], SLOW_DOWNLOAD_MS);

    expect(again.restoredFrom).toHaveLength(1);
    expect(silentNicks(ania)).toEqual([]);
    const captures = await runUntil(stage, [ania, again], (ania.tick ?? 0) + RUN_ON_TICKS);
    expectAgreement(captures, [ania, again]);
    expect(ania.waits.at(-1)?.for).toEqual([]);
  });
});
