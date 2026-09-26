import type { GameSession } from '@open-northland/lockstep';
import type { RoomSeatSetup, RoomSettings, RoomView } from '@open-northland/net-protocol';
import type { HeadlessClient } from '../../../../net-server/test/support/headless-client.js';
import { NETWORK_STEP_MS, type Stage } from '../../../../net-server/test/support/session-run.js';
import type { WorkerHeadlessClient } from './worker-headless-client.js';

/**
 * The virtual network and relay run in step with real time, for a room with a worker-hosted client.
 *
 * The inline harness (`session-run.ts`) moves a virtual clock as fast as the test thread can, which a
 * worker cannot follow: the network worker steps on its own real timers. Here each turn sleeps a
 * moment, so the worker's messages land on this thread, then moves the virtual clock by the real time
 * that passed, delivering and advancing the relay in `NETWORK_STEP_MS` slices, and advances the inline
 * clients and the worker client's runtime by the same time. The relay therefore assigns frames at the
 * pace the worker runs them. A test never waits on virtual time alone: `until` polls a condition, such
 * as the worker's recorded acknowledgements, turn by turn up to a real deadline.
 */

/** The test thread's sleep per turn, in which the worker's posts arrive. */
const TURN_MS = 5;

export type PacedMember = HeadlessClient | WorkerHeadlessClient;

export class PacedStage {
  /** While set the relay's clock emits no frames: messages still cross, so every client comes to rest
   *  on the last frame it emitted. */
  relayHeld = false;
  private lastMs = performance.now();

  constructor(
    private readonly stage: Stage,
    private readonly inline: readonly HeadlessClient[],
    private readonly workers: readonly WorkerHeadlessClient[],
    /** After each tick a client ran (inline) or its runtime delivered (worker). */
    private readonly onTick: (member: PacedMember, tick: number) => void = () => undefined,
  ) {}

  async turn(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, TURN_MS));
    const nowMs = performance.now();
    const elapsedMs = nowMs - this.lastMs;
    this.lastMs = nowMs;
    const { clock, network, relay } = this.stage;
    for (let done = 0; done < elapsedMs; done += NETWORK_STEP_MS) {
      const sliceMs = Math.min(NETWORK_STEP_MS, elapsedMs - done);
      clock.tick(sliceMs);
      network.flush();
      if (!this.relayHeld) relay.advance();
      for (const client of this.inline) {
        client.advance(sliceMs, () => {
          if (client.sim !== null) this.onTick(client, client.sim.tick);
        });
      }
    }
    await Promise.all(this.inline.map((client) => client.settled()));
    for (const worker of this.workers) worker.deliver(elapsedMs, (tick) => this.onTick(worker, tick));
  }

  /** Turn until `check` holds; throws naming `what` and every client's standing past `timeoutMs`. */
  async until(what: string, check: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (!check()) {
      if (performance.now() > deadline)
        throw new Error(`timed out waiting until ${what}: ${this.standings()}`);
      await this.turn();
    }
  }

  /** Turn for `ms` of real time. */
  async runFor(ms: number): Promise<void> {
    const end = performance.now() + ms;
    while (performance.now() < end) await this.turn();
  }

  private standings(): string {
    const inline = this.inline.map((client) => `${client.nick}@${client.tick}`);
    const workers = this.workers.map(
      (worker) => `${worker.nick}@${worker.tick} acked ${worker.ackedTick} framed ${worker.lastFrameTick}`,
    );
    return [...inline, ...workers].join(', ');
  }
}

/** What the lobby walk needs of a client, inline or worker-hosted. */
interface LobbyMember {
  readonly nick: string;
  readonly welcomed: boolean;
  readonly room: RoomView | null;
  readonly session: GameSession | null;
  readonly rejections: readonly { readonly of: string; readonly reason: string }[];
  hello(): void;
  createRoom(settings: RoomSettings, seats: readonly RoomSeatSetup[]): void;
  joinRoom(roomId: string): void;
  claimSeat(player: number): void;
  setReady(ready: boolean): void;
  start(): void;
}

export interface PacedRoomPlan {
  readonly settings: RoomSettings;
  readonly seats: readonly RoomSeatSetup[];
  /** The seat each member claims, by its index. */
  readonly seatOf: (index: number) => number;
  /** Real time a lobby step may take to cross the links and the worker. */
  readonly stepTimeoutMs: number;
}

/** Walk a room from `hello` to a started game, `members[0]` creating it, each step awaited until every
 *  member sees it. */
export async function assemblePacedRoom(
  paced: PacedStage,
  members: readonly LobbyMember[],
  plan: PacedRoomPlan,
): Promise<void> {
  const [host, ...guests] = members;
  if (host === undefined) throw new Error('a room needs a creator');
  const step = (what: string, check: () => boolean): Promise<void> =>
    paced.until(what, check, plan.stepTimeoutMs).catch((error: unknown) => {
      const rejections = members.map((member) => `${member.nick}: ${JSON.stringify(member.rejections)}`);
      throw new Error(`${String(error)}; rejections ${rejections.join('; ')}`);
    });
  for (const member of members) member.hello();
  await step('every member is welcomed', () => members.every((member) => member.welcomed));
  host.createRoom(plan.settings, plan.seats);
  await step('the room exists', () => host.room !== null);
  const roomId = host.room?.id;
  if (roomId === undefined) throw new Error(`${host.nick} created no room`);
  for (const guest of guests) guest.joinRoom(roomId);
  await step('every member is in the room', () => members.every((member) => member.room?.id === roomId));
  const seated = (index: number) => (member: LobbyMember) =>
    member.room?.members.find((view) => view.nick === members[index]?.nick)?.seat === plan.seatOf(index);
  members.forEach((member, index) => {
    member.claimSeat(plan.seatOf(index));
  });
  await step('every member sits on its seat', () =>
    members.every((_, index) => members.every(seated(index))),
  );
  for (const member of members) member.setReady(true);
  await step('every member is ready and compatible', () => {
    const room = host.room;
    if (room === null) return false;
    return (
      room.members.every((member) => member.compatibility !== null) &&
      members.every((member) => room.seats.some((seat) => seat.nick === member.nick && seat.ready))
    );
  });
  host.start();
  await step('every member has the session', () => members.every((member) => member.session !== null));
}
