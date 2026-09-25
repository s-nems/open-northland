import type { GameSession } from '@open-northland/lockstep';
import { type RoomSettings, TICK_MS } from '@open-northland/net-protocol';
import { Relay } from '@open-northland/net-server';
import { playerCommand, restoreSimulation, type SaveGame, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { testContent } from '../../sim/test/fixtures/content.js';
import { HeadlessClient } from './support/headless-client.js';
import { assembleRoom, runFor, runUntil, type Stage, settle } from './support/session-run.js';
import { seededRandom, VirtualClock, VirtualNetwork } from './support/virtual-network.js';

/**
 * Real sims on both ends of the relay, over links with injected latency and jitter: the frames the
 * relay assigns must leave every client with the same state and the same command log.
 */

const SETTINGS: RoomSettings = {
  name: 'fixture',
  world: { kind: 'scene', sceneId: 'fixture' },
  seed: 5,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
const SEATS = [
  { player: 0, mode: 'idle', offers: ['idle', 'ai', 'absent'], color: 0 },
  { player: 1, mode: 'idle', offers: ['idle', 'ai', 'absent'], color: 1 },
] as const;
const RUN_TICKS = 240;
/** Each client orders on its own cadence, so orders share ticks now and then. */
const ORDER_EVERY_TICKS = 7;
const SLOW_LINK = { latencyMs: 160, jitterMs: 40 };
const FAST_LINK = { latencyMs: 40, jitterMs: 10 };
/** Jitter schedules to run the unequal-link session over; each must end in agreement. */
const JITTER_SEEDS = [7, 8, 9];

async function buildWorld(session: GameSession): Promise<Simulation> {
  return new Simulation({ seed: session.seed, content: testContent() });
}

async function restoreWorld(_session: GameSession, save: SaveGame): Promise<Simulation> {
  return restoreSimulation(save, { content: testContent() });
}

function client(nick: string): HeadlessClient {
  return new HeadlessClient({
    token: `${nick.toLowerCase()}-token-0123456789`,
    nick,
    buildWorld,
    restoreWorld,
  });
}

function stageFor(seed: number): Stage {
  const clock = new VirtualClock();
  const relay = new Relay({ now: clock.now });
  return { clock, relay, network: new VirtualNetwork(clock, relay, seededRandom(seed)) };
}

function order(client: HeadlessClient, tick: number): void {
  const seat = client.session?.localSeat;
  if (typeof seat !== 'number') return;
  client.submit(
    playerCommand(seat, {
      kind: 'setAssistantCounter',
      player: seat,
      counter: 'extraMen',
      value: tick,
      infinite: false,
    }),
  );
}

function orderAt(client: HeadlessClient, tick: number): void {
  if (tick % ORDER_EVERY_TICKS === client.session?.localSeat) order(client, tick);
}

/** Both seats order on the same ticks, so their commands compete for one frame. */
function orderTogether(client: HeadlessClient, tick: number): void {
  if (tick % ORDER_EVERY_TICKS === 0) order(client, tick);
}

describe('a relayed session', () => {
  it.each(JITTER_SEEDS)(
    'leaves two clients on different links with one state and one log (seed %i)',
    async (seed) => {
      const stage = stageFor(seed);
      const ania = client('Ania');
      const bartek = client('Bartek');
      stage.network.link(ania, FAST_LINK);
      stage.network.link(bartek, SLOW_LINK);
      await assembleRoom(stage, [ania, bartek], {
        settings: SETTINGS,
        seats: SEATS,
        seatOf: (i) => i,
        settleMs: 400,
      });

      const captures = await runUntil(stage, [ania, bartek], RUN_TICKS, { onTick: orderAt });
      const a = captures.get(ania);
      const b = captures.get(bartek);
      expect(a?.hash).toBe(b?.hash);
      expect(a?.log).toEqual(b?.log);
      expect(a?.log.length).toBeGreaterThanOrEqual((RUN_TICKS / ORDER_EVERY_TICKS) * 2 - 4);
      expect(ania.rejections).toEqual([]);
      expect(bartek.rejections).toEqual([]);
      expect(ania.dropped).toEqual([]);
      // The slower link earns the longer input delay; the outcome above did not depend on it.
      expect(bartek.delayTicks).toBeGreaterThan(ania.delayTicks ?? Number.POSITIVE_INFINITY);
    },
  );

  it('orders two seats competing for one tick the same way on both clients', async () => {
    const stage = stageFor(3);
    const ania = client('Ania');
    const bartek = client('Bartek');
    stage.network.link(ania, FAST_LINK);
    stage.network.link(bartek, FAST_LINK);
    await assembleRoom(stage, [ania, bartek], {
      settings: SETTINGS,
      seats: SEATS,
      seatOf: (i) => i,
      settleMs: 400,
    });

    const captures = await runUntil(stage, [ania, bartek], RUN_TICKS, { onTick: orderTogether });
    const a = captures.get(ania);
    expect(a?.hash).toBe(captures.get(bartek)?.hash);
    expect(a?.log).toEqual(captures.get(bartek)?.log);
    // Some tick carried both seats' orders, so the equal logs above prove the relay's order was kept.
    const seatsByTick = new Map<number, Set<number>>();
    for (const [applyTick, , command] of a?.log ?? []) {
      if (command.kind !== 'setAssistantCounter') continue;
      seatsByTick.set(applyTick, (seatsByTick.get(applyTick) ?? new Set()).add(command.player));
    }
    expect([...seatsByTick.values()].some((seats) => seats.size === 2)).toBe(true);
  });

  it('applies a clock change on the same tick for everyone and keeps the state shared', async () => {
    const stage = stageFor(11);
    const ania = client('Ania');
    const bartek = client('Bartek');
    stage.network.link(ania, FAST_LINK);
    stage.network.link(bartek, SLOW_LINK);
    await assembleRoom(stage, [ania, bartek], {
      settings: SETTINGS,
      seats: SEATS,
      seatOf: (i) => i,
      settleMs: 400,
    });
    await runUntil(stage, [ania, bartek], 24, { onTick: orderAt });

    bartek.setClock({ speed: 2 });
    settle(stage, 400);
    expect(ania.clockNotices.at(-1)).toEqual(bartek.clockNotices.at(-1));
    expect(ania.clockNotices.at(-1)).toMatchObject({ speed: 2, paused: false, by: 'Bartek' });
    expect(ania.speed).toBe(2);

    ania.setClock({ paused: true });
    await runFor(stage, [ania, bartek], 400);
    const held = [ania.tick, bartek.tick];
    await runFor(stage, [ania, bartek], TICK_MS * 24);
    expect([ania.tick, bartek.tick]).toEqual(held);
    expect(bartek.clockNotices.at(-1)).toMatchObject({ paused: true, by: 'Ania' });

    ania.setClock({ paused: false });
    const captures = await runUntil(stage, [ania, bartek], RUN_TICKS, { onTick: orderAt });
    expect(captures.get(ania)?.hash).toBe(captures.get(bartek)?.hash);
    expect(captures.get(ania)?.log).toEqual(captures.get(bartek)?.log);
  });
});
