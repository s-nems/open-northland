import type { SessionDriver } from '@open-northland/lockstep';
import {
  components,
  type EntitySnapshot,
  type ExportSaveOptions,
  FOG_MODE,
  type FogMaskAnswer,
  type FogView,
  fogViewOfMask,
  type MatchRulesView,
  type SaveGame,
  type SimEvent,
  SnapshotMirror,
} from '@open-northland/sim';
import { type DiagEntry, diag } from '../../diag/log.js';
import { diagCadenceAt } from '../../diag/session.js';
import type { SystemProfileRow } from '../../diag/system-profile.js';
import type { OffThreadTickCost, SessionHost, StateHash, SystemSpanSink, TickDiagnostics } from '../host.js';
import { MirrorTruthWatch } from './mirror-truth-watch.js';
import type { SessionPort } from './port.js';
import {
  type AssistantFacts,
  errorFromWire,
  type FromWorker,
  type HostRequestName,
  type HostRequests,
  type TickBatch,
  type ToWorker,
  type WorkerCall,
  type WorkerReady,
  type WorkerSessionOptions,
  type WorldFacts,
} from './protocol.js';
import { ArrivalAlpha } from './render-alpha.js';
import {
  HEARTBEAT_INTERVAL_MS,
  type StallReports,
  StallWatch,
  WORKER_STALL_TIMEOUT_MS,
} from './stall-watch.js';

/** The runtime's side of a session whose sim runs in a worker. */
export interface WorkerSession<E> {
  readonly host: SessionHost;
  readonly driver: SessionDriver;
  /** What the world's builder handed over beside the sim. */
  readonly extras: E;
  readonly matchRules: MatchRulesView;
  readonly seed: number;
  readonly boot: WorkerBootCost;
  /** What the ticks the driver's last `advance` delivered cost. */
  offThreadTickCost(): OffThreadTickCost;
  /** Stop the worker; answers still pending never land. Idempotent. */
  dispose(): void;
}

/** Milliseconds of the boot handover. */
export interface WorkerBootCost {
  /** This thread's structured clone of the boot message. */
  readonly postMs: number;
  /** The worker's world build. */
  readonly buildMs: number;
  /** This thread's deserialization of the ready message, the world's first delta included. */
  readonly readyReceiveMs: number;
  /** From the post to the first delta applied. */
  readonly totalMs: number;
}

export interface WorkerSessionTimings {
  readonly heartbeatMs?: number;
  readonly stallTimeoutMs?: number;
}

type Queued =
  | {
      readonly kind: 'ticks';
      readonly batch: TickBatch;
      readonly receiveMs: number;
      readonly arrivedMs: number;
    }
  | { readonly kind: 'fog'; readonly fog: FogMaskAnswer | null };

interface PendingCall {
  resolve(answer: { readonly value: unknown; readonly tick: number }): void;
  reject(error: Error): void;
}

interface TickWaiter {
  readonly tick: number;
  resolve(): void;
}

const NO_EVENTS: readonly SimEvent[] = [];

/** What a session needs of its port once the caller routes the worker's messages to it. */
export type SessionOutlet = Pick<SessionPort, 'post' | 'close'>;

/** A session the worker is about to build, over a port whose listener the caller owns. */
export interface WorkerSessionOpening<E> {
  /** The worker's messages for this session, routed here from before {@link postBoot} on. */
  receive(message: FromWorker<E>, receiveMs: number): void;
  /** The worker failed: `ready` rejects, or the running session's next `advance` throws. */
  fail(error: Error): void;
  /** Post the message that makes the worker build the world; the boot's cost counts from here. */
  postBoot(message: unknown): void;
  /** Resolves once the worker posts `ready`; rejects when it cannot build the world. */
  readonly ready: Promise<WorkerSession<E>>;
}

/**
 * The runtime's side of one session served on `port`. The driver's `advance` delivers what the worker
 * stepped: it applies every queued batch to the mirror and runs the per-tick callback once per tick
 * record the batch carries, with that tick's events behind `tickEvents()`, then acknowledges the
 * batches with the frame's interval, which sets how far past the drawn tick the worker may step.
 */
export function sessionOverPort<E>(
  port: SessionOutlet,
  options: WorkerSessionOptions,
  reports: StallReports,
  timings: WorkerSessionTimings = {},
): WorkerSessionOpening<E> {
  let client: WorkerClient<E> | null = null;
  let settle: { resolve(session: WorkerSession<E>): void; reject(error: Error): void } | null = null;
  const ready = new Promise<WorkerSession<E>>((resolve, reject) => {
    settle = { resolve, reject };
  });
  let startMs = 0;
  let postMs = 0;
  const refuse = (error: Error): void => {
    port.close();
    settle?.reject(error);
    settle = null;
  };
  return {
    ready,
    postBoot: (message) => {
      startMs = performance.now();
      port.post(message);
      postMs = performance.now() - startMs;
    },
    fail: (error) => {
      if (client !== null) client.fail(error);
      else refuse(error);
    },
    receive: (message, receiveMs) => {
      if (client !== null) {
        client.receive(message, receiveMs);
        return;
      }
      if (message.kind === 'bootFailed') {
        relayWorkerLog(message.log);
        refuse(errorFromWire(message.error));
      } else if (message.kind === 'ready') {
        relayWorkerLog(message.ready.log);
        client = new WorkerClient(port, message.ready, options, reports, timings);
        const bootCost = {
          postMs,
          buildMs: message.ready.buildMs,
          readyReceiveMs: receiveMs,
          totalMs: performance.now() - startMs,
        };
        settle?.resolve(client.session(bootCost));
        settle = null;
      }
    },
  };
}

/** Boot a session in the worker behind `port`, the port's only session, and resolve once its world
 *  stands; see {@link sessionOverPort}. */
export function startWorkerSession<B, E>(
  port: SessionPort,
  boot: B,
  options: WorkerSessionOptions,
  reports: StallReports,
  timings: WorkerSessionTimings = {},
): Promise<WorkerSession<E>> {
  const opening = sessionOverPort<E>(port, options, reports, timings);
  port.listenFailure((error) => opening.fail(error));
  port.listen((data, receiveMs) => opening.receive(data as FromWorker<E>, receiveMs));
  const message: ToWorker<B> = { kind: 'boot', boot, options };
  opening.postBoot(message);
  return opening.ready;
}

class WorkerClient<E> {
  private readonly mirror = new SnapshotMirror();
  /** Present when the session takes diagnostics. */
  private readonly truth: MirrorTruthWatch | null;
  private readonly queue: Queued[] = [];
  private readonly calls = new Map<number, PendingCall>();
  private readonly waiters: TickWaiter[] = [];
  private readonly alpha: ArrivalAlpha;
  private readonly watch: StallWatch;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  /** Adds to a worker clock reading to place it on this thread's clock. */
  private readonly workerClockOffsetMs: number;
  private nextCallId = 0;
  private tick: number;
  private events: readonly SimEvent[] = NO_EVENTS;
  private diagnostics: TickDiagnostics | null = null;
  private departed: readonly EntitySnapshot[] = [];
  private facts: WorldFacts;
  private fog: FogView | null;
  private fogSeat: number | null;
  private paused: boolean;
  private speed: number;
  private droppedTicks = 0;
  private lastCost: OffThreadTickCost = { simMs: 0, receiveMs: 0, batches: 0, leadTicks: 0 };
  /** The newest batch's {@link TickBatch.leadTicks}. */
  private leadTicks = 0;
  /** A tick error the worker posted, or its own failure; `advance` rethrows it. */
  private failure: Error | null = null;
  private started = false;
  private spans: SystemSpanSink | null = null;
  private disposed = false;

  constructor(
    private readonly port: SessionOutlet,
    private readonly ready: WorkerReady<E>,
    options: WorkerSessionOptions,
    reports: StallReports,
    timings: WorkerSessionTimings,
  ) {
    this.mirror.apply(ready.delta);
    this.truth = options.diagnostics ? new MirrorTruthWatch(this.mirror) : null;
    this.truth?.applied(ready.delta);
    this.tick = ready.delta.tick;
    this.facts = ready.facts;
    this.fog = ready.fog === null ? null : fogViewOfMask(ready.fog);
    this.fogSeat = options.fogSeat;
    this.paused = options.paused;
    this.speed = options.speed;
    this.alpha = new ArrivalAlpha(options.speed, options.paused);
    this.workerClockOffsetMs = ready.timeOrigin - performance.timeOrigin;
    const heartbeatMs = timings.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    this.watch = new StallWatch(
      reports,
      timings.stallTimeoutMs ?? WORKER_STALL_TIMEOUT_MS,
      heartbeatMs,
      performance.now(),
    );
    this.heartbeat = setInterval(() => {
      this.post({ kind: 'ping' });
      this.watch.check(performance.now());
    }, heartbeatMs);
  }

  receive(message: FromWorker<E>, receiveMs: number): void {
    if (this.disposed) return;
    const nowMs = performance.now();
    this.watch.heard(nowMs);
    switch (message.kind) {
      case 'ticks':
        this.queue.push({ kind: 'ticks', batch: message.batch, receiveMs, arrivedMs: nowMs });
        return;
      case 'fog':
        this.queue.push({ kind: 'fog', fog: message.update.fog });
        return;
      case 'reply': {
        const call = this.calls.get(message.id);
        this.calls.delete(message.id);
        if (message.ok) call?.resolve({ value: message.value, tick: message.tick });
        else call?.reject(errorFromWire(message.error));
        return;
      }
      case 'tickError':
        diag.error('session', `worker tick ${message.tick} threw; the view keeps an earlier whole tick`);
        this.fail(errorFromWire(message.error));
        return;
      case 'ready':
      case 'bootFailed':
      case 'pong':
        return;
    }
  }

  session(boot: WorkerBootCost): WorkerSession<E> {
    return {
      host: this.host(),
      driver: this.driver(),
      extras: this.ready.extras,
      matchRules: this.ready.matchRules,
      seed: this.ready.seed,
      boot,
      offThreadTickCost: () => this.lastCost,
      dispose: () => this.dispose(),
    };
  }

  /** The worker cannot go on: the next frame's `advance` throws, where the crash capture sees it, and
   *  every pending ask ends now, so a boot awaiting one does not wait forever. */
  fail(error: Error): void {
    this.failure ??= error;
    this.release(error);
  }

  private post(message: ToWorker<unknown>): void {
    if (!this.disposed) this.port.post(message);
  }

  /** Deliver the queued batches; see {@link sessionOverPort}. Then rethrows a failure: a tick error
   *  after the ticks before it, where the inline driver's step would have thrown. */
  private advance(frameMs: number, onTick?: () => void): number {
    if (!this.started) {
      this.started = true;
      this.post({ kind: 'start' });
    }
    let delivered = 0;
    let simMs = 0;
    let receiveMs = 0;
    const departed: EntitySnapshot[] = [];
    // The worker keeps one batch in flight, spanning every tick it stepped meanwhile.
    for (let item = this.queue.shift(); item !== undefined; item = this.queue.shift()) {
      if (item.kind === 'fog') {
        this.setFog(item.fog);
        continue;
      }
      const { batch } = item;
      const applyStartMs = performance.now();
      this.mirror.apply(batch.delta);
      departed.push(...this.mirror.departed);
      if (Object.keys(batch.facts).length > 0) this.facts = { ...this.facts, ...batch.facts };
      if (batch.fog !== null) this.setFog(batch.fog.fog);
      this.droppedTicks = batch.droppedTicks;
      receiveMs += item.receiveMs + (performance.now() - applyStartMs);
      // Outside the receive figure, which reads the runtime's own cost of taking a batch in.
      this.truth?.applied(batch.delta);
      if (batch.spans !== null) this.emitSpans(batch.spans);
      this.leadTicks = batch.leadTicks;
      for (const record of batch.ticks) {
        this.tick = record.tick;
        this.events = record.events;
        this.diagnostics = record.diagnostics;
        simMs += record.simMs;
        onTick?.();
      }
      if (
        this.truth !== null &&
        batch.ticks.some((record) => diagCadenceAt(record.tick)?.invariants === true)
      ) {
        this.truth.checkIndexes(batch.delta.tick);
      }
      this.alpha.arrived(item.arrivedMs);
      delivered++;
    }
    this.tick = this.mirror.tick ?? this.tick;
    this.lastCost = { simMs, receiveMs, batches: delivered, leadTicks: this.leadTicks };
    if (delivered > 0) {
      this.departed = departed;
      this.post({ kind: 'delivered', messages: delivered, frameMs });
      this.settleWaiters();
    }
    if (this.failure !== null) throw this.failure;
    return this.alpha.at(performance.now());
  }

  /** A backlog held since before a seat pick carries the previous seat's masks: they no longer apply. */
  private setFog(answer: FogMaskAnswer | null): void {
    if (answer !== null && answer.player !== this.fogSeat) return;
    this.fog = answer === null ? null : fogViewOfMask(answer);
  }

  private emitSpans(spans: TickBatch['spans']): void {
    const sink = this.spans;
    if (sink === null || spans === null) return;
    const offset = this.workerClockOffsetMs;
    for (const span of spans) sink(span.system, span.startMs + offset, span.endMs + offset);
  }

  private call(call: WorkerCall): Promise<{ readonly value: unknown; readonly tick: number }> {
    return new Promise((resolve, reject) => {
      if (this.disposed) return;
      const id = this.nextCallId++;
      this.calls.set(id, { resolve, reject });
      this.post({ kind: 'call', id, call });
    });
  }

  private ask<K extends HostRequestName>(
    name: K,
    args: Parameters<HostRequests[K]>,
  ): ReturnType<HostRequests[K]> {
    // The worker answers the same member over its sim, so the value is that member's answer.
    return this.call({ method: 'host', name, args }).then(({ value }) => value) as ReturnType<
      HostRequests[K]
    >;
  }

  /** Resolves once the ticks the worker stood at after `call` are delivered. After a failure none
   *  will be, so it rejects with that failure; the reads that need no delivery still answer. */
  private untilStepped(call: WorkerCall): Promise<void> {
    if (this.failure !== null) return Promise.reject(this.failure);
    return this.call(call).then(({ tick }) => this.untilDelivered(tick));
  }

  /** Resolves once the delivered tick reaches `tick`. */
  private untilDelivered(tick: number): Promise<void> {
    if (this.tick >= tick) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ tick, resolve }));
  }

  private settleWaiters(): void {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      if (waiter === undefined || waiter.tick > this.tick) continue;
      this.waiters.splice(i, 1);
      waiter.resolve();
    }
  }

  /** A read still pending never lands: its asker belongs to the view being torn down, and a
   *  rejection there would read as a crash. */
  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.port.close();
    this.release(null);
  }

  /** Stop the heartbeat and drop the pending asks: with an `error` the calls reject with it and the
   *  waiters resolve, without one neither settles. */
  private release(error: Error | null): void {
    clearInterval(this.heartbeat);
    const calls = [...this.calls.values()];
    const waiters = this.waiters.splice(0);
    this.calls.clear();
    if (error === null) return;
    for (const call of calls) call.reject(error);
    for (const waiter of waiters) waiter.resolve();
  }

  private host(): SessionHost {
    const client = this;
    const ready = this.ready;
    const facts = (): WorldFacts => this.facts;
    return {
      content: ready.content,
      mapFingerprint: ready.mapFingerprint,
      landscapeTypes: ready.landscapeTypes,
      missions: ready.missions,

      get tick() {
        return client.tick;
      },
      snapshot: () => this.mirror.snapshot(),
      departed: () => this.departed,
      fogView: (player) => {
        if (player !== this.fogSeat) {
          this.fogSeat = player;
          this.post({ kind: 'fogSeat', player });
        }
        // Until the new seat's masks land the previous seat's stay drawn: an unfogged frame would
        // show the whole map for a moment.
        return this.fog;
      },
      constructionPlots: () => facts().constructionPlots,
      placementBlockerVersion: () => facts().placementBlockerVersion,
      signpostBlockerVersion: () => facts().signpostBlockerVersion,
      palisadeLayoutVersion: () => facts().palisadeLayoutVersion,
      roadSitePlacementVersion: () => facts().roadSitePlacementVersion,
      diplomacyStance: (from, to) => {
        const at = seatIndex(from, to);
        return at === null ? UNSET_STANCE : (facts().stances[at] ?? UNSET_STANCE);
      },
      hasMetPlayer: (viewer, other) => {
        const at = seatIndex(viewer, other);
        // Outside the table the sim's own rule: a player knows itself, and fog off shows everyone.
        if (at === null) return viewer === other || facts().fogMode === FOG_MODE.OFF;
        return facts().met[at] ?? false;
      },
      assistantCounters: (player) => assistantFacts(facts(), player).counters,
      assistantGrants: (player) => assistantFacts(facts(), player).grants,
      assistantWeaponVetoes: (player) => assistantFacts(facts(), player).weaponVetoes,
      assistantPostsGraduates: (player) => assistantFacts(facts(), player).postsGraduates,
      assistantMovesFlags: (player) => assistantFacts(facts(), player).movesFlags,
      needsEnabled: () => facts().needsEnabled,
      fogMode: () => facts().fogMode,
      matchOutcome: (player) => facts().matchOutcomes[player] ?? 'undecided',
      missionStatus: () => facts().missionStatus,

      tickEvents: () => this.events,
      tickDiagnostics: () =>
        this.diagnostics === null
          ? Promise.reject(new Error(`the session took no diagnostics at tick ${this.tick}`))
          : Promise.resolve(this.diagnostics),
      hashState: () => this.call({ method: 'hashState' }).then(({ value }) => value as StateHash),

      placementProbe: (...args) => this.ask('placementProbe', args),
      signpostProbe: (...args) => this.ask('signpostProbe', args),
      palisadeProbe: (...args) => this.ask('palisadeProbe', args),
      roadSiteProbe: (...args) => this.ask('roadSiteProbe', args),
      palisadeGateProbe: (...args) => this.ask('palisadeGateProbe', args),
      palisadeGateSites: (...args) => this.ask('palisadeGateSites', args),
      ownPalisadeNodes: (...args) => this.ask('ownPalisadeNodes', args),
      mooringProbe: (...args) => this.ask('mooringProbe', args),
      unlockStatus: (...args) => this.ask('unlockStatus', args),
      buildTribes: (...args) => this.ask('buildTribes', args),
      canChooseJob: (...args) => this.ask('canChooseJob', args),
      hasEarnedGood: (...args) => this.ask('hasEarnedGood', args),
      equipPickList: (...args) => this.ask('equipPickList', args),
      standsTo: (...args) => this.ask('standsTo', args),
      workStatus: (...args) => this.ask('workStatus', args),
      papers: (...args) => this.ask('papers', args),
      diplomacyLocked: (...args) => this.ask('diplomacyLocked', args),
      goodsTradedWith: (...args) => this.ask('goodsTradedWith', args),
      openTributes: (...args) => this.ask('openTributes', args),
      tradeOffersOf: (...args) => this.ask('tradeOffersOf', args),
      tradeOffersAt: (...args) => this.ask('tradeOffersAt', args),
      traderView: (...args) => this.ask('traderView', args),
      tradeHousesAttachableBy: (...args) => this.ask('tradeHousesAttachableBy', args),
      vehiclesAttachableBy: (...args) => this.ask('vehiclesAttachableBy', args),
      missionBriefingHistory: (...args) => this.ask('missionBriefingHistory', args),
      missionBriefingPage: (...args) => this.ask('missionBriefingPage', args),
      missionHuman: (...args) => this.ask('missionHuman', args),
      missionPresentation: (...args) => this.ask('missionPresentation', args),
      infoLines: (...args) => this.ask('infoLines', args),
      landscapeEdits: (...args) => this.ask('landscapeEdits', args),
      exportSave: (...args) => this.ask('exportSave', args),
      commandLog: (...args) => this.ask('commandLog', args),

      installInstruments: ({ profile, spans }) => {
        this.spans = spans;
        this.post({ kind: 'instruments', profile, spans: spans !== null });
        if (!profile) return null;
        return {
          rows: () =>
            this.call({ method: 'profileRows' }).then(({ value }) => value as readonly SystemProfileRow[]),
          reset: () => this.post({ kind: 'profileReset' }),
        };
      },
      run: (ticks) => this.untilStepped({ method: 'run', ticks }),
      settled: () => this.untilStepped({ method: 'settle' }),
    };
  }

  private driver(): SessionDriver {
    const client = this;
    return {
      get paused() {
        return client.paused;
      },
      get speed() {
        return client.speed;
      },
      get droppedTicks() {
        return client.droppedTicks;
      },
      maxStepsPerFrame: this.ready.maxStepsPerFrame,
      setPaused: (paused) => {
        if (paused === this.paused) return;
        this.paused = paused;
        this.alpha.setPaused(paused, performance.now());
        this.post({ kind: 'pause', paused });
      },
      setSpeed: (speed) => {
        if (!Number.isFinite(speed) || speed <= 0) {
          throw new Error(`session speed must be a positive number, got ${speed}`);
        }
        this.speed = speed;
        this.alpha.setSpeed(speed, performance.now());
        this.post({ kind: 'speed', speed });
      },
      advance: (elapsedMs, onTick) => this.advance(elapsedMs, onTick),
      submit: (envelope) => this.post({ kind: 'submit', envelope }),
      captureSave: (options: ExportSaveOptions = {}) =>
        this.call({ method: 'captureSave', options }).then(({ value }) => value as SaveGame),
    };
  }
}

/** A pair never set, or naming no seat, reads `enemy` in the sim. */
const UNSET_STANCE = 'enemy';

/** The seat pair's place in a facts table, or null for a pair outside it. */
function seatIndex(row: number, column: number): number | null {
  const seats = components.MAX_PLAYERS;
  const inTable = (seat: number) => Number.isInteger(seat) && seat >= 0 && seat < seats;
  return inTable(row) && inTable(column) ? row * seats + column : null;
}

/** The worker's boot log, entered into this thread's ring and console as it was logged there. */
function relayWorkerLog(entries: readonly DiagEntry[]): void {
  for (const entry of entries) diag.log(entry.channel, entry.level, `worker: ${entry.message}`, entry.data);
}

function assistantFacts(facts: WorldFacts, player: number): AssistantFacts {
  return (
    facts.assistants[player] ?? {
      counters: components.defaultAssistantCounters(),
      grants: [],
      weaponVetoes: [],
      postsGraduates: false,
      movesFlags: false,
    }
  );
}
