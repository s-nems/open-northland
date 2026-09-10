import { existsSync } from 'node:fs';
import { aiSeatsOf, type GameSession, humanSeatsOf } from '@open-northland/lockstep';
import type { RoomSeatSetup, RoomSettings } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { playerCommand, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HeadlessClient } from '../../../net-server/test/support/headless-client.js';
import { assembleRoom, runUntil, type Stage } from '../../../net-server/test/support/session-run.js';
import {
  seededRandom,
  VirtualClock,
  VirtualNetwork,
} from '../../../net-server/test/support/virtual-network.js';
import { hasRealIr } from './helpers.js';
import { realMapPath, realMapScript, realMapWorld } from './real-map-world.js';

/**
 * The relay proven on the map a session is played on: every client assembles the world from the
 * descriptor the relay broadcast, plays through frames the relay assigned over links with injected
 * latency and jitter, and must end on one state and one command log.
 *
 * `ON_RELAY_TICKS` lengthens each run; the default keeps the file within a content-suite budget.
 */

const MAP_ID = 'magiczny_las';
const TWELVE_SEAT_MAP_ID = 'magiczny_las_12_players';
const DEFAULT_RUN_TICKS = 600;
const RUN_TICKS = Number.parseInt(process.env.ON_RELAY_TICKS ?? '', 10) || DEFAULT_RUN_TICKS;
/** Orders per client, staggered by seat so some share a tick with another seat's or the AI's. */
const ORDER_EVERY_TICKS = 20;
const LINKS = [
  { latencyMs: 40, jitterMs: 10 },
  { latencyMs: 120, jitterMs: 40 },
  { latencyMs: 250, jitterMs: 80 },
];
const RULES = { fog: null, progression: null, needs: null };
/** Virtual time for a lobby step to cross the slowest link twice, with margin. */
const LOBBY_SETTLE_MS = 800;
const RUN_TIMEOUT_MS = 900_000;

async function buildWorld(session: GameSession): Promise<Simulation> {
  if (session.world.kind !== 'map') throw new Error(`a map session, not ${session.world.kind}`);
  const world = await realMapWorld({
    mapId: session.world.mapId,
    aiSeats: aiSeatsOf(session),
    humanSeats: humanSeatsOf(session),
    seed: session.seed,
    rules: session.rules,
    berryBushes: true,
  });
  return world.sim;
}

/** The room's seats as the lobby would take them from the map script: AI seats stay AI, the rest wait. */
function seatsFromScript(mapId: string): readonly RoomSeatSetup[] {
  const script = realMapScript(mapId);
  if (script === null) throw new Error(`${mapId} ships no script`);
  return script.players.map((player) => ({
    player: player.player,
    mode: player.type === 'ai' ? 'ai' : 'idle',
    color: player.colorId,
  }));
}

function stageFor(seed: number): Stage {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  return { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(seed)) };
}

function orderAt(client: HeadlessClient, tick: number): void {
  const seat = client.session?.localSeat;
  if (typeof seat !== 'number' || tick % ORDER_EVERY_TICKS !== seat % ORDER_EVERY_TICKS) return;
  client.submit(
    playerCommand(seat, {
      kind: 'setAssistantCounter',
      player: seat,
      counter: 'extraMen',
      value: tick % ORDER_EVERY_TICKS,
      infinite: false,
    }),
  );
}

async function playThrough(mapId: string, count: number): Promise<HeadlessClient[]> {
  const stage = stageFor(count);
  const seats = seatsFromScript(mapId);
  const openSeats = seats.filter((seat) => seat.mode === 'idle').map((seat) => seat.player);
  expect(openSeats.length).toBeGreaterThanOrEqual(count);
  const clients = Array.from({ length: count }, (_, i) => {
    const client = new HeadlessClient({
      token: `client-${i}-token-0123456789`,
      nick: `Gracz ${i}`,
      buildWorld,
    });
    stage.network.link(client, LINKS[i % LINKS.length]);
    return client;
  });
  const settings: RoomSettings = {
    name: mapId,
    world: { kind: 'map', mapId },
    seed: 7,
    rules: RULES,
    speed: 1,
  };
  await assembleRoom(stage, clients, {
    settings,
    seats,
    seatOf: (i) => openSeats[i] ?? -1,
    settleMs: LOBBY_SETTLE_MS,
  });
  const captures = await runUntil(stage, clients, RUN_TICKS, { onTick: orderAt });

  const [first, ...rest] = clients;
  if (first === undefined) throw new Error('no clients');
  const reference = captures.get(first);
  for (const client of rest) {
    expect(captures.get(client)?.hash, `${client.nick} against ${first.nick}`).toBe(reference?.hash);
    expect(captures.get(client)?.log).toEqual(reference?.log);
  }
  for (const client of clients) {
    expect(client.rejections, client.nick).toEqual([]);
    expect(client.dropped, client.nick).toEqual([]);
  }
  // Every seat's orders crossed the wire, and the log is not the AI's alone.
  const seatsHeard = new Set(
    reference?.log.flatMap(([, , command]) => ('player' in command ? [command.player] : [])),
  );
  for (const client of clients) {
    const seat = client.session?.localSeat;
    expect(typeof seat === 'number' && seatsHeard.has(seat), client.nick).toBe(true);
  }
  return clients;
}

describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)) && existsSync(realMapPath(TWELVE_SEAT_MAP_ID)))(
  'relayed sessions on a decoded map',
  () => {
    it('two clients on unequal links end on one state', { timeout: RUN_TIMEOUT_MS }, async () => {
      const [fast, slow] = await playThrough(MAP_ID, 2);
      // The slower link is budgeted a longer delay; the state above did not depend on it.
      expect(slow?.delayTicks).toBeGreaterThan(fast?.delayTicks ?? Number.POSITIVE_INFINITY);
    });

    it('four clients end on one state', { timeout: RUN_TIMEOUT_MS }, async () => {
      await playThrough(MAP_ID, 4);
    });

    it('twelve clients fill the twelve-seat map and end on one state', {
      timeout: RUN_TIMEOUT_MS,
    }, async () => {
      await playThrough(TWELVE_SEAT_MAP_ID, 12);
    });
  },
);
