import {
  type GameSession,
  type InitialSaveSeatSetup,
  LockstepDriver,
  parseGameSession,
  type SessionDriver,
} from '@open-northland/lockstep';
import {
  DESCRIPTOR_WORLD,
  type GovernedClock,
  MAX_ENVELOPE_BYTES,
  type PlayerFlag,
  parseServerMessage,
  RelayTransport,
  type ResponsivenessMode,
  type ResponsivenessState,
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
import { RelayLobby } from './lobby.js';
import { CommandOutbox } from './pacing/command-outbox.js';
import { CommandLatency } from './pacing/latency.js';
import { paceScale } from './pacing/pacer.js';
import { TickCost } from './pacing/tick-cost.js';
import type { RelayClientView } from './relay-client-view.js';
import { RelayRefusal } from './relay-refusal.js';
import type { ClockState } from './relay-state.js';
import { DigestTrail } from './sync/digest-trail.js';
import { DisputeCapture, type DisputeRecord } from './sync/dispute-capture.js';
import { MatchCompletion } from './sync/match-completion.js';
import {
  applyInitialSeatControl,
  openSessionWorld,
  restoreSessionWorld,
} from './world/initial-save-world.js';
import { WorldLoader } from './world/loader.js';
import { SaveOrders } from './world/save-orders.js';
import { encodeSnapshot } from './world/snapshot-codec.js';

/** The pacer alone refills and drains the jitter buffer, so a wait for a frame leaves no owed time
 *  beyond the tick it waited for: debt would run each late frame the moment it lands, and run a burst
 *  of them in one display frame. */
const OWED_TICKS_ON_REFUSAL = 1;

/** The lobby blobs a client asks the room for; each is answered on its own. */
type LobbyBlob = 'map' | 'initialSave';
const LOBBY_BLOB_OF = { requestMap: 'map', requestInitialSave: 'initialSave' } as const;

/** What a session's own recording rests on, as the world builder pinned it: the descriptor the session
 *  runs, the tick the build stands at, and the save text it started from, if any. A world without one
 *  keeps no recording, for its input is not its own command log. */
export interface OpenedReplaySource {
  readonly descriptor: GameSession;
  readonly fromTick: number;
  readonly initialSaveText: string | null;
}

/** A world the client runs, and the generation its acknowledgements carry: `DESCRIPTOR_WORLD` for a
 *  world built from the descriptor, else the tick of the snapshot it was restored from. */
export interface OpenedWorld {
  readonly sim: Simulation;
  readonly generation: number;
  readonly initialSaveFingerprint?: string;
  readonly initialSeatSetups?: readonly InitialSaveSeatSetup[];
  /** The recording's footing, when the builder pinned one: the served session captures against it,
   *  and a world that crosses without it records nothing. */
  readonly replaySource?: OpenedReplaySource;
}

/** A world the client adopted, numbered so a host can tell it from the worlds before and after it. */
export interface AdoptedWorld extends OpenedWorld {
  readonly worldId: number;
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

export interface RelayClientOptions {
  readonly token: string;
  readonly nick: string;
  /** The flag shown beside the nick; none when absent. */
  readonly flag?: PlayerFlag;
  readonly world: WorldPort;
  /** Relay messages after applying them, plus local command refusals: how a display follows the session. */
  readonly onMessage?: (message: ServerMessage) => void;
  /** A world adopted: built, or restored from a snapshot. */
  readonly onWorld?: (world: AdoptedWorld) => void;
  readonly onDropped?: (tick: number, reason: string) => void;
  /** A world port or snapshot failure, and a command issued with no world to run it. */
  readonly onError?: (what: string, error: unknown) => void;
  /** Whether a message sent now reaches the relay; default always. A command issued while it does not
   *  waits in the outbox rather than being lost on the way. */
  readonly connected?: () => boolean;
  /** Milliseconds for the click-to-apply and tick-cost measurements; default `performance.now`. */
  readonly now?: () => number;
  /** A world's `loaded` waits for `worldShown`, so the room's clock starts once every host displays
   *  its world rather than once its sim is built. */
  readonly awaitsDisplay?: boolean;
}

/** One client of a relayed session, and the session driver and clock the host runs it through. */
export class RelayClient extends RelayLobby implements SessionDriver, RelayClientView {
  sim: Simulation | null = null;
  readonly latency: CommandLatency;
  private readonly outbox = new CommandOutbox();
  /** The newest snapshot tick this client knows the relay caches; an older upload changes nothing. */
  private knownSnapshotTick: number | null = null;
  readonly digests = new DigestTrail();
  private readonly verdicts = new DisputeCapture();
  private driver: LockstepDriver | null = null;
  private transport: RelayTransport | null = null;
  private world = DESCRIPTOR_WORLD;
  private adoptedWorlds = 0;
  private currentWorldId: number | null = null;
  private readonly loader = new WorldLoader();
  private reportRestoredWorld = false;
  /** The adopted world the host displays; with `awaitsDisplay`, `loaded` waits for it. */
  private shownWorldId: number | null = null;
  /** The adopted world's `loaded` waits for the host to display it. */
  private loadedHeld = false;
  private alpha = 1;
  private readonly completion = new MatchCompletion();
  private readonly saveOrders = new SaveOrders();
  private readonly tickCost = new TickCost();
  private snapshotInFlight: Promise<void> | null = null;
  private awaitingResume = false;
  private shrinkingBuffer = false;
  /** Per lobby blob, the requests on the current socket the relay has not answered with it or a refusal. */
  private readonly lobbyBlobRequests = new Map<LobbyBlob, number>();
  /** A snapshot the relay serves this client on the current socket: its world is gone, or stands
   *  behind the cached snapshot the relay replays from. */
  private snapshotOwed = false;
  /** The newest tick a `clock` (the one it runs next) or a `frame` on the current socket named. */
  private relayTickHeard: number | null = null;

  get session(): GameSession | null {
    return this.state.session;
  }

  get clockState(): ClockState | null {
    return this.state.clockState;
  }

  get responsiveness(): ResponsivenessState {
    return this.state.responsiveness;
  }

  setResponsiveness(mode: ResponsivenessMode): void {
    this.send({ kind: 'responsiveness', mode });
  }

  get waitingFor(): readonly WaitedMember[] {
    return this.state.waitingFor;
  }

  get delayTicks(): number | null {
    return this.state.delayTicks;
  }

  get roundTripMs(): number | null {
    return this.state.roundTripMs;
  }

  /** The adopted world's number, counted from 1 over this client's life; null while it holds none. */
  get worldId(): number | null {
    return this.currentWorldId;
  }

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
    super(options.token, options.nick, options.flag);
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.latency = new CommandLatency();
  }

  override hello(): void {
    // A new socket is writable before its retained world has been admitted again. Buffered frames
    // must wait for start -> loaded, otherwise their acknowledgements arrive while not loaded.
    this.awaitingResume = this.session !== null;
    // The relay keeps what the old socket delivered and lands it before anything sent now; the
    // `clock` that follows `start` names its tick, which bounds where those commands land.
    this.latency.carryOver(this.delayTicks ?? 0);
    this.relayTickHeard = null;
    // A new socket is served again from its own `start`, `desync` and requests.
    this.lobbyBlobRequests.clear();
    this.snapshotOwed = false;
    super.hello();
  }

  /** Whether a large message is owed to this client, which a link carrying it shows only once whole. */
  get awaitsTransfer(): boolean {
    return this.lobbyBlobRequests.size > 0 || this.snapshotOwed;
  }

  override requestMap(): void {
    this.owe('map');
    super.requestMap();
  }

  override requestInitialSave(): void {
    this.owe('initialSave');
    super.requestInitialSave();
  }

  private owe(blob: LobbyBlob): void {
    this.lobbyBlobRequests.set(blob, (this.lobbyBlobRequests.get(blob) ?? 0) + 1);
  }

  /** `retryTooSoon` answers only the repeated request, while an earlier one may still be served; any
   *  other refusal means none of them will be. */
  private lobbyBlobRefused(blob: LobbyBlob, code: string): void {
    const left = (this.lobbyBlobRequests.get(blob) ?? 0) - 1;
    if (code === 'retryTooSoon' && left > 0) this.lobbyBlobRequests.set(blob, left);
    else this.lobbyBlobRequests.delete(blob);
  }

  get tick(): number | null {
    return this.sim?.tick ?? null;
  }

  get paused(): boolean {
    return this.completion.halted || (this.clockState?.paused ?? false);
  }

  /** The requested speed; the clock runs slower while `governed` is set. */
  get speed(): number {
    return this.clockState?.speed ?? this.session?.speed ?? 1;
  }

  get governed(): GovernedClock | null {
    return this.clockState?.governed ?? null;
  }

  /** A request, sent only when it would change what the relay last broadcast. */
  setPaused(paused: boolean): void {
    if (paused !== (this.clockState?.paused ?? false)) this.setClock({ paused });
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
    return this.state.outOfSync;
  }

  /** The relay's last desync verdict this client took part in, on either side; kept across worlds. */
  get dispute(): DisputeRecord | null {
    return this.verdicts.record;
  }

  captureSave(options: ExportSaveOptions = {}): Promise<SaveGame> {
    if (this.sim === null || this.state.outOfSync || this.options.connected?.() === false)
      return Promise.reject(new Error('A save requires a connected, synchronized world'));
    const save = exportSaveGame(this.sim, { ...this.saveHeader(), ...options });
    return this.saveOrders.request(save, this.world, (message) => this.send(message));
  }

  /** Commands need a world and must fit in one atomic wire envelope. A refusal here reaches the host
   *  as a relay refusal would, without consuming an earlier command's latency stamp. */
  submit(envelope: CommandEnvelope): void {
    if (this.session !== null && typeof this.session.localSeat !== 'number') return;
    if (this.driver === null) {
      this.options.onError?.('command', new Error(`${this.nick} holds no world`));
      this.refuseLocally('notLoaded');
      return;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
    if (bytes > MAX_ENVELOPE_BYTES) {
      this.refuseLocally('envelopeTooLarge');
      return;
    }
    if (!this.outbox.push(envelope, this.now(), bytes)) {
      this.refuseLocally('commandBudget');
      return;
    }
    this.sendQueued();
  }

  private refuseLocally(code: 'notLoaded' | 'envelopeTooLarge' | 'commandBudget'): void {
    this.options.onMessage?.({ kind: 'rejected', of: 'command', reason: { code } });
  }

  /** Send what the relay's per-tick budget has room for; the rest goes as this seat's commands apply,
   *  after those a socket or world change carried have settled, and not before a new socket's room
   *  admits the world again. */
  private sendQueued(): void {
    const driver = this.driver;
    if (driver === null || this.outbox.size === 0 || this.options.connected?.() === false) return;
    if (this.latency.carrying || this.awaitingResume) return;
    this.outbox.drain(
      () => this.latency.sent,
      (envelope, clickedAt, bytes) => {
        driver.submit(envelope);
        this.latency.issued(clickedAt, bytes);
      },
    );
  }

  receive(raw: unknown): void {
    const message = parseServerMessage(raw, parseGameSession);
    const previousBufferTarget = this.responsiveness.bufferTicks;
    this.state.apply(message);
    switch (message.kind) {
      case 'responsiveness':
        if (message.bufferTicks !== previousBufferTarget)
          this.shrinkingBuffer = message.bufferTicks < previousBufferTarget;
        break;
      case 'welcome':
        this.saveOrders.cancel('The relay connection changed while saving');
        break;
      case 'saveOrders':
        this.saveOrders.receive(message);
        break;
      case 'ended':
        this.completion.confirm(message.tick, message.hash);
        break;
      case 'left':
        this.awaitingResume = false;
        this.lobbyBlobRequests.clear();
        this.snapshotOwed = false;
        this.knownSnapshotTick = null;
        this.relayTickHeard = null;
        this.latency.forgetInFlight();
        // Gestures held for this room's game would act on the next room's. A world dropped within
        // the room keeps them for the one restored in its place, the same game further on.
        this.outbox.clear();
        this.completion.clear();
        this.dropWorld();
        break;
      case 'start':
        this.learnSnapshotTick(message.snapshotTick);
        this.snapshotOwed = message.snapshotTick !== null;
        this.startSession(message.session, message.snapshotTick);
        break;
      case 'clock':
        this.heardRelayTick(message.tick);
        this.driver?.setSpeed(runningSpeed(message));
        break;
      case 'frame':
        this.heardRelayTick(message.tick);
        if (this.transport === null) this.earlyFrames.push(message);
        else this.transport.receiveFrame(message);
        break;
      case 'desync':
        this.snapshotOwed = true;
        this.verdicts.freeze('diverged', message.tick, message.domains, [message.reference]);
        this.dropWorld();
        break;
      case 'disputed':
        this.verdicts.freeze('reference', message.tick, message.domains, message.diverged);
        break;
      case 'snapshotRequest':
        this.answerSnapshotRequest();
        break;
      case 'blob':
        if (message.type === 'map' || message.type === 'initialSave')
          this.lobbyBlobRequests.delete(message.type);
        if (message.type === 'snapshot') this.snapshotOwed = false;
        if (message.type === 'snapshot' && message.tick !== null) {
          this.learnSnapshotTick(message.tick);
          this.restoreFrom(message.bytes, message.tick);
        }
        break;
      case 'ping':
        this.send({ kind: 'pong', t: message.t });
        break;
      case 'rejected':
        if (message.of === 'requestMap' || message.of === 'requestInitialSave')
          this.lobbyBlobRefused(LOBBY_BLOB_OF[message.of], message.reason.code);
        if (message.of === 'saveOrders') this.saveOrders.refuse(message.requestId, message.reason);
        if (message.of === 'command') {
          this.latency.refused();
          this.sendQueued();
        }
        // A world the relay would not take leaves this client with nothing to run; the host decides.
        if (message.of === 'loaded') this.options.onError?.('open', new RelayRefusal(message.reason));
        break;
      default:
        // The rest only changes the lobby and session state applied above, or nothing here.
        break;
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
    if (this.awaitingResume) return this.alpha;
    const driver = this.driver;
    const transport = this.transport;
    if (driver === null || transport === null) return this.alpha;
    this.reportResult();
    this.verifyResult();
    driver.setPaused(this.completion.halted || (this.paused && transport.bufferedTicks === 0));
    // A tick's cost runs from the end of the previous tick's work here to its acknowledgement: the
    // frame's admission, the sim step and the host's `onTick`.
    this.tickCost.begin(this.now());
    this.alpha = driver.advance(
      elapsedMs *
        paceScale(
          transport.bufferedTicks,
          driver.speed,
          this.responsiveness.bufferTicks,
          this.shrinkingBuffer,
        ),
      () => {
        if (this.completion.detect(this.sim)) driver.setPaused(true);
        onTick?.();
        this.acknowledge(this.tickCost.end(this.now()));
        this.reportResult();
        this.verifyResult();
        this.tickCost.begin(this.now());
      },
    );
    // Finish only after consuming the former reserve. At high speed new frames can arrive before
    // every display advance, so observing the buffer only before advancing would miss that moment.
    if (transport.bufferedTicks < this.responsiveness.bufferTicks) this.shrinkingBuffer = false;
    this.sendQueued();
    return this.alpha;
  }

  /** Host work for this client's ticks done outside `advance`, such as posting a batch of them to a
   *  display; the next acknowledged tick's cost carries it. */
  chargeTickWork(ms: number): void {
    this.tickCost.charge(ms);
  }

  /** The wall time a tick costs the host's display, once per drawn frame that took in `ticks`. The
   *  load an acknowledgement reports is the larger of it and the sim's, so the relay paces the room
   *  for a slow display too. */
  drawnTickCost(ms: number, ticks: number): void {
    this.tickCost.drawn(ms, ticks);
  }

  private verifyResult(): void {
    const failure = this.completion.verify(this.sim);
    if (failure !== null) this.options.onError?.('result', new Error(failure));
  }

  private reportResult(): void {
    this.completion.report(
      this.sim,
      this.world,
      !this.loadedHeld && this.options.connected?.() !== false,
      (message) => this.send(message),
    );
  }

  private acknowledge(tickMs: number): void {
    const digest = this.sim?.syncDigest();
    if (digest === null || digest === undefined) return;
    this.digests.record(digest.tick, digest.domains);
    const inputs = this.sim?.syncDigestInputs();
    if (inputs !== null && inputs !== undefined) this.verdicts.retain(inputs);
    this.send({
      kind: 'ack',
      tick: digest.tick,
      digest: digest.domains,
      world: this.world,
      load: { tickMs, buffered: this.bufferedTicks },
    });
  }

  private startSession(session: GameSession, snapshotTick: number | null): void {
    this.awaitingResume = false;
    this.completion.reconnect();
    if (this.sim !== null && !this.state.outOfSync) {
      this.reportLoaded();
      return;
    }
    if (this.loader.busy) {
      this.reportRestoredWorld = true;
      return;
    }
    if (this.state.outOfSync) {
      this.askForSnapshot();
      return;
    }
    this.track(
      'open',
      this.loader.run(
        () => openSessionWorld(this.options.world, session, snapshotTick),
        (opened) => {
          if (opened !== null) {
            applyInitialSeatControl(opened, session, snapshotTick);
            this.adoptWorld(opened);
            this.reportLoaded();
          } else {
            this.askForSnapshot();
          }
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
    this.track(
      'restore',
      this.loader.run(
        () => restoreSessionWorld(this.options.world, session, snapshot, tick),
        (opened) => {
          if (opened !== null) {
            applyInitialSeatControl(opened, session, tick);
            this.adoptWorld(opened);
            if (this.reportRestoredWorld) this.reportLoaded();
          }
        },
      ),
    );
  }

  /** The host draws the world numbered `worldId`: a `loaded` held for it goes out. */
  worldShown(worldId: number): void {
    if (worldId !== this.currentWorldId) return;
    this.shownWorldId = worldId;
    if (!this.loadedHeld) return;
    this.loadedHeld = false;
    this.reportLoaded();
  }

  /** Tell the relay where the adopted world stands, once the host displays it when it must. */
  private reportLoaded(): void {
    const sim = this.sim;
    if (sim === null) return;
    if (this.options.awaitsDisplay === true && this.shownWorldId !== this.currentWorldId) {
      this.loadedHeld = true;
      return;
    }
    // Frames the relay pruned behind its cache come back as that snapshot.
    this.snapshotOwed = this.knownSnapshotTick !== null && sim.tick < this.knownSnapshotTick;
    this.send({ kind: 'loaded', tick: sim.tick, world: this.world });
  }

  private askForSnapshot(): void {
    this.snapshotOwed = true;
    this.send({ kind: 'loaded', tick: null });
  }

  private adoptWorld(opened: OpenedWorld): void {
    const session = this.session;
    if (session === null) throw new Error(`${this.nick} has no session to run`);
    const { sim } = opened;
    sim.setSyncDigest(true, { captureInputs: true });
    this.sim = sim;
    this.world = opened.generation;
    this.state.outOfSync = false;
    this.adoptedWorlds++;
    this.currentWorldId = this.adoptedWorlds;
    const seat = session.localSeat;
    this.transport = new RelayTransport({
      send: (message) => this.send(message),
      parseEnvelope: parseCommandEnvelope,
      onDropped: (tick, reason, envelope) => {
        if (envelope.origin === 'player' && envelope.player === seat) this.latency.dropped();
        this.options.onDropped?.(tick, reason);
      },
      fromTick: sim.tick,
      onFrame: (frame) => {
        for (const command of frame.commands) {
          if (command.envelope.origin === 'player' && command.envelope.player === seat) {
            this.latency.applied(this.now());
          }
        }
        this.latency.ran(frame.tick);
      },
    });
    for (const frame of this.earlyFrames) this.transport.receiveFrame(frame);
    this.earlyFrames.length = 0;
    // A restored world may already cover the frames of commands in flight, which then never apply;
    // they settle once this world stands past the last tick the relay could land them on.
    this.latency.carryOver(this.delayTicks ?? 0);
    if (this.relayTickHeard !== null)
      this.latency.relayAt(this.relayTickHeard, this.delayTicks ?? 0, sim.tick);
    this.driver = new LockstepDriver({
      sim,
      transport: this.transport,
      speed: session.speed,
      owedTicksOnRefusal: OWED_TICKS_ON_REFUSAL,
    });
    const clock = this.clockState;
    if (clock !== null) this.driver.setSpeed(runningSpeed(clock));
    this.options.onWorld?.({ ...opened, worldId: this.adoptedWorlds });
  }

  private dropWorld(): void {
    this.shrinkingBuffer = false;
    this.snapshotInFlight = null;
    this.saveOrders.cancel('The world changed while saving');
    this.loader.invalidate();
    this.verdicts.forgetWorld();
    this.reportRestoredWorld = false;
    this.loadedHeld = false;
    this.sim = null;
    this.currentWorldId = null;
    this.completion.dropWorld();
    this.driver = null;
    this.transport = null;
    this.earlyFrames.length = 0;
  }

  private heardRelayTick(tick: number): void {
    if (this.relayTickHeard === null || tick > this.relayTickHeard) this.relayTickHeard = tick;
    this.latency.relayAt(this.relayTickHeard, this.delayTicks ?? 0, this.tick);
  }

  private learnSnapshotTick(tick: number | null): void {
    if (tick !== null && (this.knownSnapshotTick === null || tick > this.knownSnapshotTick))
      this.knownSnapshotTick = tick;
  }

  /** The export is synchronous on the sim's thread; a world behind the cached snapshot skips it, since
   *  the relay keeps the newer copy. A same-tick upload still counts, as it can vouch for a held cache. */
  private answerSnapshotRequest(): void {
    const sim = this.sim;
    if (sim === null || this.snapshotInFlight !== null) return;
    if (this.knownSnapshotTick !== null && sim.tick < this.knownSnapshotTick) return;
    const tick = sim.tick;
    const world = this.world;
    // A relay retry can arrive while compression is still running. One upload answers both requests.
    const work = encodeSnapshot(exportSaveGame(sim, this.saveHeader()))
      .then((bytes) => {
        if (this.sim !== sim) return;
        this.sendBlob({ type: 'snapshot', to: null, tick, world, bytes });
      })
      .finally(() => {
        if (this.snapshotInFlight === work) this.snapshotInFlight = null;
      });
    this.snapshotInFlight = work;
    this.track('snapshot', work);
  }

  /** A snapshot names the session's map, so the client restoring it can hold it to its own world. */
  private saveHeader(): ExportSaveOptions {
    const world = this.session?.world;
    return world?.kind === 'map' ? { mapId: world.mapId } : {};
  }

  /** Keep `work` for `settled`, and report its failure. */
  private track(what: string, work: Promise<void>): void {
    this.pending.add(work);
    work.then(
      () => this.pending.delete(work),
      (error: unknown) => {
        this.pending.delete(work);
        this.options.onError?.(what, error);
      },
    );
  }
}

/** The speed the relay's clock actually runs at: the governed one below the requested one. */
function runningSpeed(clock: ClockState): number {
  return clock.governed?.speed ?? clock.speed;
}
