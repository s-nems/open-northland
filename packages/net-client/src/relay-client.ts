import {
  type GameSession,
  LockstepDriver,
  parseGameSession,
  type SessionDriver,
} from '@open-northland/lockstep';
import {
  DESCRIPTOR_WORLD,
  parseServerMessage,
  RelayTransport,
  type ServerMessage,
  type WaitedMember,
  type WireFrame,
} from '@open-northland/net-protocol';
import {
  type CommandEnvelope,
  type ExportSaveOptions,
  exportSaveGame,
  parseCommandEnvelope,
  type SaveGame,
  type Simulation,
} from '@open-northland/sim';
import { DigestTrail } from './digest-trail.js';
import { applyInitialSeatControl, openSessionWorld, restoreSessionWorld } from './initial-save-world.js';
import { CommandLatency } from './latency.js';
import { RelayLobby } from './lobby.js';
import { MatchCompletion } from './match-completion.js';
import { paceScale } from './pacer.js';
import { SaveOrders } from './save-orders.js';
import { encodeSnapshot } from './snapshot-codec.js';
import { WorldLoader } from './world-loader.js';

/** A world the client runs, and the generation its acknowledgements carry: `DESCRIPTOR_WORLD` for a
 *  world built from the descriptor, else the tick of the snapshot it was restored from. */
export interface OpenedWorld {
  readonly sim: Simulation;
  readonly generation: number;
  readonly initialSaveFingerprint?: string;
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
export class RelayClient extends RelayLobby implements SessionDriver {
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
  private readonly loader = new WorldLoader();
  private reportRestoredWorld = false;
  private alpha = 1;
  private readonly completion = new MatchCompletion();
  private readonly saveOrders = new SaveOrders();

  get resultTick(): number | null {
    return this.completion.resultTick;
  }

  get endedTick(): number | null {
    return this.completion.readyTick(this.sim);
  }
  /** Frames that arrived before the world was adopted, kept for the transport. */
  private readonly earlyFrames: WireFrame[] = [];
  private readonly pending = new Set<Promise<void>>();
  private readonly options: RelayClientOptions;
  private readonly now: () => number;

  constructor(options: RelayClientOptions) {
    super(options.token, options.nick);
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.latency = new CommandLatency();
  }

  get tick(): number | null {
    return this.sim?.tick ?? null;
  }

  get paused(): boolean {
    return (
      this.resultTick !== null || this.completion.confirmedTick !== null || (this.clockState?.paused ?? false)
    );
  }

  get speed(): number {
    return this.clockState?.speed ?? this.session?.speed ?? 1;
  }

  /** A request, sent only when it would change what the relay last broadcast. */
  setPaused(paused: boolean): void {
    if (this.resultTick === null && this.completion.confirmedTick === null && paused !== this.paused)
      this.setClock({ paused });
  }

  setSpeed(speed: number): void {
    if (this.resultTick === null && this.completion.confirmedTick === null && speed !== this.speed)
      this.setClock({ speed });
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

  captureSave(options: ExportSaveOptions = {}): Promise<SaveGame> {
    if (this.sim === null || this.outOfSync || this.options.connected?.() === false)
      return Promise.reject(new Error('A save requires a connected, synchronized world'));
    const save = exportSaveGame(this.sim, { ...this.saveHeader(), ...options });
    return this.saveOrders.request(save, this.world, (message) => this.send(message));
  }

  /** Upload the world as a save, the way a player's in-game save reaches the room. */
  shareSave(to: string | null, save: SaveGame): Promise<void> {
    const sim = this.sim;
    if (sim === null) throw new Error(`${this.nick} has no world to save`);
    const world = this.session?.world;
    if (save.header.tick > sim.tick || (world?.kind === 'map' && save.header.mapId !== world.mapId))
      throw new Error('The captured save belongs to another world');
    const tick = save.header.tick;
    return this.track(
      'save',
      encodeSnapshot(save).then((bytes) => {
        if (this.sim !== sim) return;
        this.sendBlob({ type: 'save', to, tick, bytes });
      }),
    );
  }

  /** A command with no world to stamp it or no connection to carry it is dropped and reported. */
  submit(envelope: CommandEnvelope): void {
    if (this.resultTick !== null || this.completion.confirmedTick !== null) return;
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
        this.saveOrders.cancel('The relay connection changed while saving');
        this.nick = message.nick;
        this.welcomed = true;
        break;
      case 'rooms':
        this.rooms = message.rooms;
        break;
      case 'room':
        this.room = message.room;
        break;
      case 'saveOrders':
        this.saveOrders.receive(message);
        break;
      case 'ended':
        this.completion.confirm(message.tick, message.hash);
        this.waitingFor = [];
        break;
      case 'left':
        this.completion.clear();
        this.room = null;
        this.session = null;
        this.clockState = null;
        this.waitingFor = [];
        this.delayTicks = null;
        this.outOfSync = false;
        this.dropWorld();
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
      case 'mapRequest':
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
        if (message.type === 'snapshot' && message.tick !== null)
          this.restoreFrom(message.bytes, message.tick);
        break;
      case 'ping':
        this.roundTripMs = message.roundTripMs;
        this.send({ kind: 'pong', t: message.t });
        break;
      case 'rejected':
        if (message.of === 'saveOrders') this.saveOrders.refuse(message.requestId, message.reason);
        if (message.of === 'command') this.latency.refused();
        // A world the relay would not take leaves this client with nothing to run; the host decides.
        if (message.of === 'loaded') this.options.onError?.('open', new Error(message.reason));
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
    this.reportResult();
    this.verifyResult();
    driver.setPaused(
      this.resultTick !== null ||
        this.tick === this.completion.confirmedTick ||
        (this.paused && transport.bufferedTicks === 0),
    );
    this.alpha = driver.advance(elapsedMs * paceScale(transport.bufferedTicks), () => {
      if (this.completion.detect(this.sim) || this.tick === this.completion.confirmedTick) {
        driver.setPaused(true);
      }
      this.acknowledge();
      this.reportResult();
      this.verifyResult();
      onTick?.();
    });
    return this.alpha;
  }

  private verifyResult(): void {
    const failure = this.completion.verify(this.sim);
    if (failure !== null) this.options.onError?.('result', new Error(failure));
  }

  private reportResult(): void {
    this.completion.report(this.sim, this.world, this.options.connected?.() !== false, (message) =>
      this.send(message),
    );
  }

  private acknowledge(): void {
    const digest = this.sim?.syncDigest();
    if (digest === null || digest === undefined) return;
    this.digests.record(digest.tick, digest.domains);
    this.send({ kind: 'ack', tick: digest.tick, digest: digest.domains, world: this.world });
  }

  private startSession(session: GameSession, snapshotTick: number | null): void {
    this.completion.reconnect();
    this.session = session;
    if (this.sim !== null && !this.outOfSync) {
      this.send({ kind: 'loaded', tick: this.sim.tick, world: this.world });
      return;
    }
    if (this.loader.busy) {
      this.reportRestoredWorld = true;
      return;
    }
    if (this.outOfSync) {
      this.send({ kind: 'loaded', tick: null });
      return;
    }
    void this.track(
      'open',
      this.loader.run(
        () => openSessionWorld(this.options.world, session, snapshotTick),
        (opened) => {
          if (opened !== null) {
            applyInitialSeatControl(opened, session, snapshotTick);
            this.adoptWorld(opened);
          }
          this.send(
            opened === null
              ? { kind: 'loaded', tick: null }
              : { kind: 'loaded', tick: opened.sim.tick, world: opened.generation },
          );
        },
      ),
    );
  }

  private restoreFrom(snapshot: string, tick: number): void {
    const session = this.session;
    if (session === null) {
      this.options.onError?.('restore', new Error(`${this.nick} got a snapshot before its session`));
      return;
    }
    this.dropWorld();
    void this.track(
      'restore',
      this.loader.run(
        () => restoreSessionWorld(this.options.world, session, snapshot, tick),
        (opened) => {
          if (opened !== null) {
            applyInitialSeatControl(opened, session, tick);
            this.adoptWorld(opened);
            if (this.reportRestoredWorld) {
              this.send({ kind: 'loaded', tick: opened.sim.tick, world: opened.generation });
            }
          }
        },
      ),
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
      onDropped: (tick, reason, envelope) => {
        if (envelope.origin === 'player' && envelope.player === seat) this.latency.refused();
        this.options.onDropped?.(tick, reason);
      },
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
    this.saveOrders.cancel('The world changed while saving');
    this.loader.invalidate();
    this.reportRestoredWorld = false;
    this.sim = null;
    this.completion.dropWorld();
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
        if (this.sim !== sim) return;
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
        this.options.onError?.(what, error);
      },
    );
    return work;
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
