import { TICK_MS } from '@open-northland/net-protocol';
import type { Relay } from '@open-northland/net-server';
import type { Command } from '@open-northland/sim';
import type { HeadlessClient } from './headless-client.js';
import type { Link, LinkOptions, VirtualClock, VirtualNetwork } from './virtual-network.js';

/** Fine enough for injected jitter to land between frames. */
export const NETWORK_STEP_MS = 5;

export interface Stage {
  readonly clock: VirtualClock;
  readonly network: VirtualNetwork;
  readonly relay: Relay;
}

/** Advance virtual time by `ms`, delivering messages and polling the relay along the way. */
export function settle(stage: Stage, ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += NETWORK_STEP_MS) {
    stage.clock.tick(NETWORK_STEP_MS);
    stage.network.flush();
    stage.relay.advance();
  }
}

/** Let virtual time pass with the clients running: how a held or paused game is waited out. A
 *  client's world build, restore or snapshot in flight lands before the next step. */
export async function runFor(stage: Stage, clients: readonly HeadlessClient[], ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += NETWORK_STEP_MS) {
    settle(stage, NETWORK_STEP_MS);
    for (const client of clients) client.advance(NETWORK_STEP_MS);
    await Promise.all(clients.map((client) => client.settled()));
  }
}

/** Connect `client` over a fresh link and introduce it again, as a returning player does. */
export function relink(stage: Stage, client: HeadlessClient, options: LinkOptions): Link {
  const link = stage.network.link(client, options);
  client.hello();
  return link;
}

export interface Capture {
  readonly hash: string;
  readonly log: readonly (readonly [applyTick: number, sequence: number, command: Command])[];
}

export interface RunOptions {
  /** Runs after each of a client's ticks; where a test issues that client's orders. */
  readonly onTick?: (client: HeadlessClient, tick: number) => void;
  readonly virtualLimitMs?: number;
}

/** Run every client to `untilTick` and capture its state hash and command log exactly there. */
export async function runUntil(
  stage: Stage,
  clients: readonly HeadlessClient[],
  untilTick: number,
  options: RunOptions = {},
): Promise<Map<HeadlessClient, Capture>> {
  const captures = new Map<HeadlessClient, Capture>();
  const deadline = stage.clock.now() + (options.virtualLimitMs ?? untilTick * TICK_MS * 4 + 60_000);
  while (captures.size < clients.length) {
    if (stage.clock.now() > deadline) {
      const standings = clients.map((client) => `${client.nick}@${client.tick}`).join(', ');
      throw new Error(`not every client reached tick ${untilTick} by the deadline: ${standings}`);
    }
    settle(stage, NETWORK_STEP_MS);
    for (const client of clients) {
      if (captures.has(client)) continue;
      client.advance(NETWORK_STEP_MS, () => {
        const sim = client.sim;
        if (sim === null) return;
        options.onTick?.(client, sim.tick);
        if (sim.tick === untilTick) {
          captures.set(client, {
            hash: sim.hashState(),
            log: sim.commands.log.map((entry) => [entry.applyTick, entry.sequence, entry.command] as const),
          });
        }
      });
    }
    await Promise.all(clients.map((client) => client.settled()));
  }
  return captures;
}

export interface RoomPlan {
  readonly settings: Parameters<HeadlessClient['createRoom']>[0];
  readonly seats: Parameters<HeadlessClient['createRoom']>[1];
  /** The seat each client claims, by its index in `clients`. */
  readonly seatOf: (index: number) => number;
  /** Virtual time to let each lobby step cross the links; a link's round trip plus margin. */
  readonly settleMs: number;
}

/** Walk a room from `hello` to a started game: `clients[0]` creates it and the rest join. */
export async function assembleRoom(
  stage: Stage,
  clients: readonly HeadlessClient[],
  plan: RoomPlan,
): Promise<string> {
  const [host, ...guests] = clients;
  if (host === undefined) throw new Error('a room needs a creator');
  for (const client of clients) client.hello();
  settle(stage, plan.settleMs);
  host.createRoom(plan.settings, plan.seats);
  settle(stage, plan.settleMs);
  const roomId = host.room?.id;
  if (roomId === undefined)
    throw new Error(`${host.nick} created no room: ${JSON.stringify(host.rejections)}`);
  for (const guest of guests) guest.joinRoom(roomId);
  settle(stage, plan.settleMs);
  clients.forEach((client, index) => {
    client.claimSeat(plan.seatOf(index));
  });
  settle(stage, plan.settleMs);
  for (const client of clients) client.setReady(true);
  settle(stage, plan.settleMs);
  host.start();
  settle(stage, plan.settleMs);
  await Promise.all(clients.map((client) => client.settled()));
  for (const client of clients) {
    if (client.session === null)
      throw new Error(`${client.nick} got no session: ${JSON.stringify(client.rejections)}`);
  }
  return roomId;
}
