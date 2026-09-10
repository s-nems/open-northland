import {
  type GameSession,
  LockstepDriver,
  parseGameSession,
  type SessionDriver,
} from '@open-northland/lockstep';
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
  type WaitedMember,
  type WireFrame,
} from '@open-northland/net-protocol';
import {
  type CommandEnvelope,
  type ExportSaveOptions,
  exportSaveGame,
  parseCommandEnvelope,
  type Simulation,
} from '@open-northland/sim';
import { DigestTrail } from './digest-trail.js';
import { CommandLatency } from './latency.js';
import { paceScale } from './pacer.js';
import { encodeSnapshot } from './snapshot-codec.js';

/** A world the client runs, and the generation its acknowledgements carry: `DESCRIPTOR_WORLD` for a
 *  world built from the descriptor, else the tick of the snapshot it was restored from. */
export interface OpenedWorld {
  readonly sim: Simulation;
  readonly generation: number;
}

/**
 * How the client gets a world. `open` answers `start`: a world built from the descriptor, one restored
 * from a snapshot the port already holds, or null to ask the relay for the snapshot it has cached
 * (allowed only when `snapshotTick` names one). `restore` takes a snapshot blob the relay served,
 * still encoded; null means the world is rebuilt elsewhere, and this client keeps none.
 */
export interface WorldPort {
  open(session: GameSession, snapshotTick: number | null): Promise<OpenedWorld | null>;
  restore(session: GameSession, snapshot: string): Promise<OpenedWorld | null>;
}

export type ClockState = Extract<ServerMessage, { kind: 'clock' }>;
type BlobUpload = Omit<Extract<ClientMessage, { kind: 'blob' }>, 'kind'>;
type Send = (message: ClientMessage) => void;

export interface RelayClientOptions {
  readonly token: string;
  readonly nick: string;
  readonly world: WorldPort;
  /** Every relay message, after the client has acted on it: how a display follows the session. */
  readonly onMessage?: (message: ServerMessage) => void;
  /** A world adopted: built, or restored from a snapshot. */
  readonly onWorld?: (world: OpenedWorld) => void;
  readonly onDropped?: (tick: number, reason: string) => void;
  /** A world port or snapshot failure, and a command issued with no world or no connection to send it. */
  readonly onError?: (what: string, error: unknown) => void;
  /** Whether a message sent now reaches the relay; default always. A command issued while it does not
   *  is dropped here rather than lost on the way. */
  readonly connected?: () => boolean;
  /** Milliseconds for the click-to-apply measurement; default `performance.now`. */
  readonly now?: () => number;
}

/** One client of a relayed session, and the session driver and clock the host runs it through. */
export class RelayClient implements SessionDriver {
  readonly token: string;
  nick: string;
  welcomed = false;
  room: RoomView | null = null;
  session: GameSession | null = null;
  sim: Simulation | null = null;
  delayTicks: number | null = null;
  /** The relay's smoothed round trip to this client, from its last ping. */
  roundTripMs: number | null = null;
  /** The relay's last word on the clock. */
  clockState: ClockState | null = null;
  /** The relay's last word on who the room waits for. */
  waitingFor: readonly WaitedMember[] = [];
  readonly latency: CommandLatency;
  readonly digests = new DigestTrail();
  private driver: LockstepDriver | null = null;
  private transport: RelayTransport | null = null;
  private world = DESCRIPTOR_WORLD;
  /** Set by a desync notice: the next world comes from a snapshot, whatever `start` offers. */
  private outOfSync = false;
  private opening = false;
  private alpha = 1;
  /** Frames that arrived before the world was adopted, kept for the transport. */
  private readonly earlyFrames: WireFrame[] = [];
  private readonly pending = new Set<Promise<void>>();
  private send: Send = () => {
    throw new Error(`${this.nick} is not attached to a network`);
  };
  private readonly options: RelayClientOptions;
  private readonly now: () => number;

  constructor(options: RelayClientOptions) {
    this.options = options;
    this.token = options.token;
    this.nick = options.nick;
    this.now = options.now ?? (() => performance.now());
    this.latency = new CommandLatency();
  }

  attach(send: Send): void {
    this.send = send;
  }

  get tick(): number | null {
    return this.sim?.tick ?? null;
  }

  get paused(): boolean {
    return this.clockState?.paused ?? false;
  }

  get speed(): number {
    return this.clockState?.speed ?? this.session?.speed ?? 1;
  }

  /** A request, sent only when it would change what the relay last broadcast. */
  setPaused(paused: boolean): void {
    if (paused !== this.paused) this.setClock({ paused });
  }

  setSpeed(speed: number): void {
    if (speed !== this.speed) this.setClock({ speed });
  }

  get droppedTicks(): number {
    return this.driver?.droppedTicks ?? 0;
  }

  get maxStepsPerFrame(): number {
    return this.driver?.maxStepsPerFrame ?? 0;
  }

  /** Frames received and not yet run. */
  get bufferedTicks(): number {
    return this.transport?.bufferedTicks ?? 0;
  }

  get isOutOfSync(): boolean {
    return this.outOfSync;
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
  shareSave(to: string | null): Promise<void> {
    const sim = this.sim;
    if (sim === null) throw new Error(`${this.nick} has no world to save`);
    const tick = sim.tick;
    return this.track(
      'save',
      encodeSnapshot(exportSaveGame(sim, this.saveHeader())).then((bytes) => {
        this.sendBlob({ type: 'save', to, tick, bytes });
      }),
    );
  }

  /** A command with no world to stamp it or no connection to carry it is dropped and reported. */
  submit(envelope: CommandEnvelope): void {
    if (this.driver === null) {
      this.options.onError?.('command', new Error(`${this.nick} holds no world`));
      return;
    }
    if (this.options.connected?.() === false) {
      this.options.onError?.('command', new Error(`${this.nick} is not connected`));
      return;
    }
    this.driver.submit(envelope);
    this.latency.issued(this.now());
  }

  receive(raw: unknown): void {
    const message = parseServerMessage(raw, parseGameSession);
    switch (message.kind) {
      case 'welcome':
        this.nick = message.nick;
        this.welcomed = true;
        break;
      case 'rooms':
        break;
      case 'room':
        this.room = message.room;
        break;
      case 'left':
        this.room = null;
        break;
      case 'start':
        this.startSession(message.session, message.snapshotTick);
        break;
      case 'clock':
        this.clockState = message;
        this.driver?.setSpeed(message.speed);
        break;
      case 'frame':
        if (this.transport === null) this.earlyFrames.push(message);
        else this.transport.receiveFrame(message);
        break;
      case 'delay':
        this.delayTicks = message.ticks;
        break;
      case 'waiting':
        this.waitingFor = message.for;
        break;
      case 'kickVote':
      case 'kicked':
      case 'chat':
      case 'error':
        break;
      case 'desync':
        this.outOfSync = true;
        this.dropWorld();
        break;
      case 'snapshotRequest':
        this.answerSnapshotRequest();
        break;
      case 'blob':
        if (message.type === 'snapshot') this.restoreFrom(message.bytes);
        break;
      case 'ping':
        this.roundTripMs = message.roundTripMs;
        this.send({ kind: 'pong', t: message.t });
        break;
      case 'rejected':
        if (message.of === 'command') this.latency.refused();
        break;
      default:
        assertNever(message);
    }
    this.options.onMessage?.(message);
  }

  /** Resolves once every world build, restore or snapshot in flight has finished. */
  settled(): Promise<void> {
    return Promise.all(this.pending).then(() => undefined);
  }

  /** Feed elapsed display time, paced to hold the jitter buffer; `onTick` runs after each applied tick.
   *  A paused session still runs the frames it holds: the relay emitted them before it stopped, so
   *  every client comes to rest on the same tick. */
  advance(elapsedMs: number, onTick?: () => void): number {
    const driver = this.driver;
    const transport = this.transport;
    if (driver === null || transport === null) return this.alpha;
    driver.setPaused(this.paused && transport.bufferedTicks === 0);
    this.alpha = driver.advance(elapsedMs * paceScale(transport.bufferedTicks), () => {
      this.acknowledge();
      onTick?.();
    });
    return this.alpha;
  }

  private acknowledge(): void {
    const digest = this.sim?.syncDigest();
    if (digest === null || digest === undefined) return;
    this.digests.record(digest.tick, digest.domains);
    this.send({ kind: 'ack', tick: digest.tick, digest: digest.domains, world: this.world });
  }

  private startSession(session: GameSession, snapshotTick: number | null): void {
    this.session = session;
    if (this.sim !== null && !this.outOfSync) {
      this.send({ kind: 'loaded', tick: this.sim.tick, world: this.world });
      return;
    }
    if (this.outOfSync) {
      this.send({ kind: 'loaded', tick: null });
      return;
    }
    // A `start` repeated while the world is still opening (a reconnect mid-boot) is answered by the
    // one `loaded` the opening sends.
    if (this.opening) return;
    this.opening = true;
    void this.track(
      'open',
      this.options.world.open(session, snapshotTick).then((opened) => {
        this.opening = false;
        if (opened === null) {
          this.send({ kind: 'loaded', tick: null });
          return;
        }
        this.adoptWorld(opened);
        this.send({ kind: 'loaded', tick: opened.sim.tick, world: opened.generation });
      }),
    );
  }

  private restoreFrom(snapshot: string): void {
    const session = this.session;
    if (session === null) throw new Error(`${this.nick} got a snapshot before its session`);
    this.dropWorld();
    void this.track(
      'restore',
      this.options.world.restore(session, snapshot).then((opened) => {
        if (opened !== null) this.adoptWorld(opened);
      }),
    );
  }

  private adoptWorld(opened: OpenedWorld): void {
    const session = this.session;
    if (session === null) throw new Error(`${this.nick} has no session to run`);
    const { sim } = opened;
    sim.setSyncDigest(true);
    this.sim = sim;
    this.world = opened.generation;
    this.outOfSync = false;
    const seat = session.localSeat;
    this.transport = new RelayTransport({
      send: (message) => this.send(message),
      parseEnvelope: parseCommandEnvelope,
      onDropped: (tick, reason) => this.options.onDropped?.(tick, reason),
      fromTick: sim.tick,
      onFrame: (frame) => {
        for (const command of frame.commands) {
          if (command.envelope.origin === 'player' && command.envelope.player === seat) {
            this.latency.applied(this.now());
          }
        }
      },
    });
    for (const frame of this.earlyFrames) this.transport.receiveFrame(frame);
    this.earlyFrames.length = 0;
    this.driver = new LockstepDriver({ sim, transport: this.transport, speed: session.speed });
    const clock = this.clockState;
    if (clock !== null) this.driver.setSpeed(clock.speed);
    this.options.onWorld?.(opened);
  }

  private dropWorld(): void {
    this.sim = null;
    this.driver = null;
    this.transport = null;
    this.earlyFrames.length = 0;
  }

  private answerSnapshotRequest(): void {
    const sim = this.sim;
    if (sim === null) return;
    const tick = sim.tick;
    void this.track(
      'snapshot',
      encodeSnapshot(exportSaveGame(sim, this.saveHeader())).then((bytes) => {
        this.sendBlob({ type: 'snapshot', to: null, tick, bytes });
      }),
    );
  }

  /** A snapshot names the session's map, so the client restoring it can hold it to its own world. */
  private saveHeader(): ExportSaveOptions {
    const world = this.session?.world;
    return world?.kind === 'map' ? { mapId: world.mapId } : {};
  }

  /** Keep `work` for `settled`, and report its failure; the returned promise still rejects for a
   *  caller that awaits it. */
  private track(what: string, work: Promise<void>): Promise<void> {
    this.pending.add(work);
    work.then(
      () => this.pending.delete(work),
      (error: unknown) => {
        this.pending.delete(work);
        this.opening = false;
        this.options.onError?.(what, error);
      },
    );
    return work;
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
