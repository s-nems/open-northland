import { type GameSession, LockstepDriver, parseGameSession } from '@open-northland/lockstep';
import {
  type ClientMessage,
  DESCRIPTOR_WORLD,
  PROTOCOL_VERSION,
  parseServerMessage,
  RelayTransport,
  type RoomSeatSetup,
  type RoomSettings,
  type RoomView,
  type ServerMessage,
  type WireFrame,
} from '@open-northland/net-protocol';
import {
  type CommandEnvelope,
  exportSaveGame,
  parseCommandEnvelope,
  type SaveGame,
  type Simulation,
} from '@open-northland/sim';
import { decodeSnapshot, encodeSnapshot } from './snapshot-codec.js';

export interface HeadlessClientOptions {
  readonly token: string;
  readonly nick: string;
  /** Assemble the world the descriptor names; the real entry's twin for whichever content the test has. */
  readonly buildWorld: (session: GameSession) => Promise<Simulation>;
  /** Rebuild the world from a snapshot another client took; the real entry's restore twin. */
  readonly restoreWorld: (session: GameSession, save: SaveGame) => Promise<Simulation>;
}

type Notice<K extends ServerMessage['kind']> = Extract<ServerMessage, { kind: K }>;
export type ClockNotice = Notice<'clock'>;
type BlobUpload = Omit<Extract<ClientMessage, { kind: 'blob' }>, 'kind'>;

type Send = (message: ClientMessage) => void;

/**
 * A client of the relay with no display: it runs the real sim through the lockstep driver over the
 * relay transport, acknowledges every tick with its digest, answers pings and snapshot requests,
 * follows the clock, rebuilds from a snapshot when told to, and records what the relay told it.
 */
export class HeadlessClient {
  readonly token: string;
  nick: string;
  welcomed = false;
  room: RoomView | null = null;
  session: GameSession | null = null;
  sim: Simulation | null = null;
  driver: LockstepDriver | null = null;
  delayTicks: number | null = null;
  readonly clockNotices: ClockNotice[] = [];
  readonly waits: Notice<'waiting'>[] = [];
  readonly votes: Notice<'kickVote'>[] = [];
  readonly kicks: Notice<'kicked'>[] = [];
  readonly desyncs: Notice<'desync'>[] = [];
  /** Blobs other than the snapshots this client rebuilt from. */
  readonly blobs: Notice<'blob'>[] = [];
  readonly restoredFrom: number[] = [];
  snapshotsSent = 0;
  /** The generation of the world in play, echoed in every acknowledgement. */
  private world = DESCRIPTOR_WORLD;
  /** Set by a desync notice: the next world comes from a snapshot, whatever `start` offers. */
  private outOfSync = false;
  readonly rejections: { readonly of: string; readonly reason: string }[] = [];
  readonly errors: string[] = [];
  readonly dropped: string[] = [];
  private transport: RelayTransport | null = null;
  /** Frames that arrived before the world was built, kept for the transport. */
  private readonly earlyFrames: WireFrame[] = [];
  private loading: Promise<void> | null = null;
  private send: Send = () => {
    throw new Error(`${this.nick} is not attached to a network`);
  };
  private readonly buildWorld: HeadlessClientOptions['buildWorld'];
  private readonly restoreWorld: HeadlessClientOptions['restoreWorld'];

  constructor(options: HeadlessClientOptions) {
    this.token = options.token;
    this.nick = options.nick;
    this.buildWorld = options.buildWorld;
    this.restoreWorld = options.restoreWorld;
  }

  attach(send: Send): void {
    this.send = send;
  }

  get tick(): number | null {
    return this.sim?.tick ?? null;
  }

  hello(): void {
    this.send({ kind: 'hello', protocol: PROTOCOL_VERSION, token: this.token, nick: this.nick });
  }

  createRoom(settings: RoomSettings, seats: readonly RoomSeatSetup[]): void {
    this.send({ kind: 'createRoom', settings, seats });
  }

  joinRoom(roomId: string): void {
    this.send({ kind: 'joinRoom', roomId });
  }

  claimSeat(player: number | null): void {
    this.send({ kind: 'claimSeat', player });
  }

  setReady(ready: boolean): void {
    this.send({ kind: 'setReady', ready });
  }

  start(): void {
    this.send({ kind: 'start' });
  }

  setClock(change: { readonly speed?: number; readonly paused?: boolean }): void {
    this.send({ kind: 'clock', ...change });
  }

  say(text: string): void {
    this.send({ kind: 'chat', text });
  }

  kick(player: number): void {
    this.send({ kind: 'kick', player });
  }

  sendBlob(upload: BlobUpload): void {
    this.send({ kind: 'blob', ...upload });
  }

  /** Upload the world as a save, the way a player's in-game save reaches the room. */
  shareSave(to: string | null): void {
    if (this.sim === null) throw new Error(`${this.nick} has no world to save`);
    this.sendBlob({ type: 'save', to, tick: this.sim.tick, bytes: encodeSnapshot(exportSaveGame(this.sim)) });
  }

  submit(envelope: CommandEnvelope): void {
    if (this.driver === null) throw new Error(`${this.nick} has no session to submit to`);
    this.driver.submit(envelope);
  }

  receive(raw: unknown): void {
    const message = parseServerMessage(raw, parseGameSession);
    switch (message.kind) {
      case 'welcome':
        this.nick = message.nick;
        this.welcomed = true;
        return;
      case 'rooms':
        return;
      case 'room':
        this.room = message.room;
        return;
      case 'left':
        this.room = null;
        return;
      case 'start':
        this.startSession(message.session, message.snapshotTick);
        return;
      case 'clock':
        this.clockNotices.push(message);
        this.driver?.setSpeed(message.speed);
        this.driver?.setPaused(message.paused);
        return;
      case 'frame':
        if (this.transport === null) this.earlyFrames.push(message);
        else this.transport.receiveFrame(message);
        return;
      case 'delay':
        this.delayTicks = message.ticks;
        return;
      case 'waiting':
        this.waits.push(message);
        return;
      case 'kickVote':
        this.votes.push(message);
        return;
      case 'kicked':
        this.kicks.push(message);
        return;
      case 'desync':
        this.desyncs.push(message);
        this.outOfSync = true;
        this.dropWorld();
        return;
      case 'snapshotRequest':
        this.answerSnapshotRequest();
        return;
      case 'blob':
        if (message.type === 'snapshot') this.restoreFrom(message);
        else this.blobs.push(message);
        return;
      case 'chat':
        return;
      case 'ping':
        this.send({ kind: 'pong', t: message.t });
        return;
      case 'rejected':
        this.rejections.push({ of: message.of, reason: message.reason });
        return;
      case 'error':
        this.errors.push(message.reason);
        return;
      default:
        assertNever(message);
    }
  }

  /** Resolves once a world build or restore in flight has finished. */
  settled(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  advance(elapsedMs: number, onTick?: () => void): void {
    this.driver?.advance(elapsedMs, () => {
      this.acknowledge();
      onTick?.();
    });
  }

  private acknowledge(): void {
    const digest = this.sim?.syncDigest();
    if (digest === null || digest === undefined) return;
    this.send({ kind: 'ack', tick: digest.tick, digest: digest.domains, world: this.world });
  }

  private startSession(session: GameSession, snapshotTick: number | null): void {
    this.session = session;
    if (this.sim !== null && !this.outOfSync) {
      this.send({ kind: 'loaded', tick: this.sim.tick, world: this.world });
      return;
    }
    if (snapshotTick !== null || this.outOfSync) {
      this.send({ kind: 'loaded', tick: null });
      return;
    }
    this.loading = this.buildWorld(session).then((sim) => {
      this.adoptWorld(sim, DESCRIPTOR_WORLD);
      this.send({ kind: 'loaded', tick: sim.tick, world: DESCRIPTOR_WORLD });
    });
  }

  private restoreFrom(blob: Notice<'blob'>): void {
    const session = this.session;
    if (session === null) throw new Error(`${this.nick} got a snapshot before its session`);
    this.dropWorld();
    this.loading = this.restoreWorld(session, decodeSnapshot(blob.bytes)).then((sim) => {
      this.restoredFrom.push(sim.tick);
      this.adoptWorld(sim, sim.tick);
    });
  }

  private adoptWorld(sim: Simulation, world: number): void {
    const session = this.session;
    if (session === null) throw new Error(`${this.nick} has no session to run`);
    sim.setSyncDigest(true);
    this.sim = sim;
    this.world = world;
    this.outOfSync = false;
    this.transport = new RelayTransport({
      send: (message) => this.send(message),
      parseEnvelope: parseCommandEnvelope,
      onDropped: (tick, reason) => this.dropped.push(`${tick}: ${reason}`),
      fromTick: sim.tick,
    });
    for (const frame of this.earlyFrames) this.transport.receiveFrame(frame);
    this.earlyFrames.length = 0;
    this.driver = new LockstepDriver({ sim, transport: this.transport, speed: session.speed });
    const clock = this.clockNotices.at(-1);
    if (clock !== undefined) {
      this.driver.setSpeed(clock.speed);
      this.driver.setPaused(clock.paused);
    }
  }

  private dropWorld(): void {
    this.sim = null;
    this.driver = null;
    this.transport = null;
    this.earlyFrames.length = 0;
  }

  private answerSnapshotRequest(): void {
    if (this.sim === null) return;
    this.snapshotsSent++;
    this.sendBlob({
      type: 'snapshot',
      to: null,
      tick: this.sim.tick,
      bytes: encodeSnapshot(exportSaveGame(this.sim)),
    });
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
