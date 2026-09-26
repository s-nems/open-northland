import { MessageChannel, type MessagePort, Worker } from 'node:worker_threads';
import type { GameSession, SessionDriver } from '@open-northland/lockstep';
import type {
  ClientMessage,
  RoomSeatSetup,
  RoomSettings,
  ServerMessage,
  WireDigest,
} from '@open-northland/net-protocol';
import type { CommandEnvelope } from '@open-northland/sim';
import { TEST_COMPATIBILITY } from '../../../../net-server/test/support/compatibility.js';
import type { LinkedClient } from '../../../../net-server/test/support/virtual-network.js';
import type { MapWorkerBoot } from '../../../src/entries/map/world-inputs.js';
import { type HostedRelayedWorld, NetworkConnection } from '../../../src/net/connection.js';
import { relayedSessionDriver } from '../../../src/net/net-worker-client.js';
import type { SessionPort } from '../../../src/session/worker/port.js';
import type { FromWorker, WorkerSessionOptions } from '../../../src/session/worker/protocol.js';
import { DURABLE_EVENT_KINDS } from '../../../src/view/runtime/world-events.js';
import { nodeWorkerPort } from '../session-worker/node-ports.js';
import type { NetWorkerData } from './node-net-worker.js';
import type { FromWorkerLink, ToWorkerLink } from './port-link.js';

/** The worker never opens this URL: its link factory carries the relay over a port instead. */
const RELAY_URL = 'ws://relay.test';

type Notice<K extends ServerMessage['kind']> = Extract<ServerMessage, { kind: K }>;

/** An acknowledgement the worker's client sent the relay, and when it reached this thread. */
export interface RecordedAck {
  readonly tick: number;
  readonly digest: WireDigest;
  readonly atMs: number;
}

/** A tick batch the worker posted to the runtime, as it left the worker. */
export interface RecordedBatch {
  readonly lastTick: number;
  readonly ticks: number;
  readonly shedTicks: number;
  readonly atMs: number;
}

export interface WorkerHeadlessClientOptions {
  /** The bundled `node-net-worker.ts`. */
  readonly workerPath: string;
  readonly token: string;
  readonly nick: string;
  /** The world inputs the runtime assembles for a started session. */
  readonly boot: (session: GameSession) => MapWorkerBoot;
}

/** The world's session options as the relayed entry passes them: the relay runs the clock, so the
 *  worker sheds what the runtime leaves undelivered. */
function relayedOptions(session: GameSession): WorkerSessionOptions {
  return {
    speed: session.speed,
    paused: false,
    fogSeat: null,
    diagnostics: false,
    pauseOnSubMission: false,
    undelivered: 'shed',
    retainedEventKinds: DURABLE_EVENT_KINDS,
  };
}

/**
 * A relay client run the way the relayed entry runs it: `NetworkConnection` on this thread with its
 * mirror and worker session, the client, its clock and its sim in a `worker_threads` network worker.
 * The worker's relay link is a port this object plugs into the virtual network, so the relay sees the
 * same raw messages a socket would carry, and the test reads every acknowledgement off that link.
 *
 * The worker steps on its own real timers. This thread stands in for the frame loop with `deliver`,
 * which a test holds back with `stalled` to play a runtime that stops drawing.
 */
export class WorkerHeadlessClient implements LinkedClient {
  readonly nick: string;
  readonly connection: NetworkConnection;
  readonly acks: RecordedAck[] = [];
  readonly batches: RecordedBatch[] = [];
  readonly waits: Notice<'waiting'>[] = [];
  readonly desyncs: Notice<'desync'>[] = [];
  readonly rejections: { readonly of: string; readonly reason: string }[] = [];
  readonly failures: unknown[] = [];
  /** The last frame the relay sent this client. */
  lastFrameTick = 0;
  world: HostedRelayedWorld | null = null;
  /** The tick the served world stood at when the worker handed it over. */
  openedAtTick: number | null = null;
  /** While set, `deliver` delivers nothing: the runtime's frame loop has stopped. */
  stalled = false;
  private driver: SessionDriver | null = null;
  private send: ((message: ClientMessage) => void) | null = null;
  private readonly link: MessagePort;

  constructor(options: WorkerHeadlessClientOptions) {
    this.nick = options.nick;
    const channel = new MessageChannel();
    this.link = channel.port1;
    const workerData: NetWorkerData = { link: channel.port2 };
    const worker = new Worker(options.workerPath, { workerData, transferList: [channel.port2] });
    this.link.on('message', (message: FromWorkerLink) => this.fromLink(message));
    this.connection = new NetworkConnection(RELAY_URL, { token: options.token, nick: options.nick }, () =>
      this.observed(nodeWorkerPort(worker)),
    );
    this.connection.subscribe((event) => {
      if (event.kind === 'message') this.heard(event.message);
      else if (event.kind === 'failure') this.failures.push(event.error);
    });
    this.connection.bindWorld(
      {
        open: async (session, snapshotTick, host) => {
          // A world the relay has a snapshot for is asked of the relay, as the headless client does.
          if (snapshotTick !== null) return;
          await host(options.boot(session), relayedOptions(session));
        },
        restore: async (session, _header, host) => {
          await host(options.boot(session), relayedOptions(session));
        },
      },
      (world) => {
        this.world = world;
        this.openedAtTick = world.session.host.tick;
        this.driver = relayedSessionDriver(world.session.driver, this.connection.client);
      },
    );
  }

  get welcomed(): boolean {
    return this.connection.client.welcomed;
  }
  get room() {
    return this.connection.client.room;
  }
  get session() {
    return this.connection.client.session;
  }
  /** The tick the runtime's mirror stands at; null before a world is served. */
  get tick(): number | null {
    return this.world?.session.host.tick ?? null;
  }
  /** The last tick the worker acknowledged to the relay. */
  get ackedTick(): number {
    return this.acks.at(-1)?.tick ?? 0;
  }

  /** The socket opened: the worker's client says hello. */
  hello(): void {
    this.toLink({ kind: 'open' });
  }
  createRoom(settings: RoomSettings, seats: readonly RoomSeatSetup[]): void {
    this.connection.client.createRoom(settings, seats);
  }
  joinRoom(roomId: string): void {
    this.connection.client.joinRoom(roomId);
  }
  claimSeat(player: number): void {
    this.connection.client.claimSeat(player);
  }
  setReady(ready: boolean): void {
    this.connection.client.setReady(ready);
  }
  start(): void {
    this.connection.client.start();
  }

  /** An order the runtime issues, through the served world's driver. */
  submit(envelope: CommandEnvelope): void {
    if (this.driver === null) throw new Error(`${this.nick} serves no world to order in`);
    this.driver.submit(envelope);
  }

  /** One frame of the runtime: deliver what the worker stepped, `onTick` after each delivered tick. */
  deliver(elapsedMs: number, onTick?: (tick: number) => void): void {
    const { driver, world } = this;
    if (this.stalled || driver === null || world === null) return;
    driver.advance(elapsedMs, () => onTick?.(world.session.host.tick));
  }

  attach(send: (message: ClientMessage) => void): void {
    this.send = send;
  }

  /** A relay message from the virtual network, onto the worker's link. */
  receive(raw: unknown): void {
    const message = raw as { readonly kind?: unknown; readonly tick?: unknown };
    if (message.kind === 'frame' && typeof message.tick === 'number') this.lastFrameTick = message.tick;
    this.toLink({ kind: 'message', raw });
  }

  dispose(): void {
    this.world?.session.dispose();
    this.connection.dispose(false);
    this.link.close();
  }

  private toLink(message: ToWorkerLink): void {
    this.link.postMessage(message);
  }

  private fromLink(message: FromWorkerLink): void {
    if (message.kind === 'closed') return;
    const sent = message.message;
    if (sent.kind === 'ack')
      this.acks.push({ tick: sent.tick, digest: sent.digest, atMs: performance.now() });
    this.send?.(sent);
  }

  private heard(message: ServerMessage): void {
    switch (message.kind) {
      case 'room':
        if (
          message.room.state === 'lobby' &&
          message.room.members.find((member) => member.nick === this.nick)?.compatibility === null
        ) {
          this.connection.client.setCompatibility(TEST_COMPATIBILITY);
        }
        return;
      case 'waiting':
        this.waits.push(message);
        return;
      case 'desync':
        this.desyncs.push(message);
        return;
      case 'rejected':
        this.rejections.push({ of: message.of, reason: message.reason });
        return;
      default:
        return;
    }
  }

  /** The runtime's port, recording each tick batch as it arrives from the worker. */
  private observed(port: SessionPort): SessionPort {
    return {
      ...port,
      listen: (receive) =>
        port.listen((data, receiveMs) => {
          const message = data as FromWorker<unknown>;
          if (message.kind === 'ticks') {
            const { batch } = message;
            this.batches.push({
              lastTick: batch.delta.tick,
              ticks: batch.ticks.length,
              shedTicks: batch.shedTicks,
              atMs: performance.now(),
            });
          }
          receive(data, receiveMs);
        }),
    };
  }
}
