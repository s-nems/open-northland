import type { SessionDriver } from '@open-northland/lockstep';
import {
  cloneEvents,
  MS_PER_TICK,
  type SimEvent,
  type Simulation,
  SnapshotDeltaStream,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { diag } from '../../diag/log.js';
import { diagCadenceAt } from '../../diag/session.js';
import { profiledInstrument, SystemProfile } from '../../diag/system-profile.js';
import type { SessionHost } from '../host.js';
import { inlineSessionHost } from '../inline-host.js';
import { changedFacts, readWorldFacts } from './facts.js';
import type { SessionPort } from './port.js';
import {
  type FogUpdate,
  type FromWorker,
  isHostRequest,
  type SystemSpan,
  type TickBatch,
  type TickRecord,
  type ToWorker,
  type WorkerCall,
  type WorkerSessionOptions,
  type WorldFacts,
  wireError,
} from './protocol.js';
import { TickOutbox } from './tick-outbox.js';

/** A built world: the sim, and plain data the runtime reads once. */
export interface BuiltWorld<E> {
  readonly sim: Simulation;
  readonly extras: E;
}

/** Stepping outside the session clock, which only a session that is its own authority can do. */
export interface OffClockRun {
  /** Step the next tick, paused or not, with the commands the session holds for it. */
  step(): void;
}

/** What a world builder hands the worker: the world, the driver that clocks it, and `run` where the
 *  session may step outside that clock. */
export interface HostedBuild<E> extends BuiltWorld<E> {
  readonly driver: SessionDriver;
  readonly run?: OffClockRun;
}

export type WorldBuilder<B, E> = (boot: B, options: WorkerSessionOptions) => HostedBuild<E>;

/**
 * Session time the worker may run past the last tick the runtime delivered before its undelivered
 * policy applies. A runtime that stops drawing, such as a hidden tab, would otherwise have the worker
 * bank every tick's events without bound; a slow frame shorter than this costs no ticks.
 */
export const UNDELIVERED_LIMIT_SECONDS = 2;

/** {@link UNDELIVERED_LIMIT_SECONDS} in ticks at a session speed. */
export function undeliveredTickLimit(speed: number): number {
  return Math.ceil(UNDELIVERED_LIMIT_SECONDS * TICKS_PER_SECOND * speed);
}

/** Ticks `run` steps between yields, so heartbeats and deliveries are answered during a long run. */
const RUN_SLICE_TICKS = 10;

const NO_EVENTS: readonly SimEvent[] = [];

const yieldToMessages = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** What a replaced session's pending answers reject with. */
export const REPLACED_SESSION_MESSAGE = 'the served world was replaced by a newly booted one';

/** Serve sessions on `port`: build a world from each `boot` message and run it, a later boot replacing
 *  the session served until then. */
export function serveSession<B, E>(port: SessionPort, build: WorldBuilder<B, E>): void {
  let session: ServedSession<E> | null = null;
  const post = (message: FromWorker<E>, transfer?: readonly ArrayBuffer[]): void =>
    port.post(message, transfer);
  port.listen((data) => {
    const message = data as ToWorker<B>;
    if (message.kind === 'ping') {
      post({ kind: 'pong' });
      return;
    }
    if (message.kind === 'boot') {
      session?.replace();
      session = null;
      const startMs = performance.now();
      try {
        const built = build(message.boot, message.options);
        session = new ServedSession(post, built, message.options, performance.now() - startMs);
      } catch (err) {
        post({ kind: 'bootFailed', error: wireError(err), log: diag.entries() });
      }
      return;
    }
    session?.receive(message);
  });
}

export type Post<E> = (message: FromWorker<E>, transfer?: readonly ArrayBuffer[]) => void;

/** The worker's side of a running session: its sim, driver, clock and the batches it owes the runtime. */
export class ServedSession<E> {
  private readonly sim: Simulation;
  private readonly driver: SessionDriver;
  private readonly offClock: OffClockRun | undefined;
  private readonly deltas: SnapshotDeltaStream;
  /** Answers the request-shaped reads as the inline host does, over this thread's sim. */
  private readonly answers: SessionHost;
  private readonly options: WorkerSessionOptions;
  private readonly outbox: TickOutbox;
  /** The calls being answered; a replacement rejects them. */
  private readonly answering = new Set<number>();
  private lastFacts: WorldFacts;
  private fogSeat: number | null;
  private lastFogKey: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastLoopMs = performance.now();
  private stepStartMs = 0;
  private started = false;
  private running = false;
  private broken = false;
  /** A later boot replaced this session: it steps and posts no more. */
  private replaced = false;
  private profile: SystemProfile | null = null;
  private spans: SystemSpan[] | null = null;

  constructor(
    private readonly postToRuntime: Post<E>,
    built: HostedBuild<E>,
    options: WorkerSessionOptions,
    buildMs: number,
  ) {
    const { sim, driver } = built;
    this.sim = sim;
    this.options = options;
    this.driver = driver;
    this.offClock = built.run;
    this.outbox = new TickOutbox(options.undelivered, driver.maxStepsPerFrame, {
      take: (records, shedTicks) => this.takeBatch(records, shedTicks),
      post: (batch) => this.post({ kind: 'ticks', batch }, fogTransfer(batch.fog)),
      limit: () => undeliveredTickLimit(this.driver.speed),
    });
    this.answers = inlineSessionHost(sim, { snapshots: 'live' });
    // Without the events: each tick's record carries its own, so the stream's clone would be dropped.
    this.deltas = new SnapshotDeltaStream({
      world: sim.world,
      get tick() {
        return sim.tick;
      },
      events: { current: () => NO_EVENTS },
    });
    this.fogSeat = options.fogSeat;
    this.lastFacts = readWorldFacts(sim);
    const delta = this.deltas.next();
    if (delta === null) throw new Error('a fresh delta stream opens with a rebuild');
    const fog = this.fogSeat === null ? null : sim.fogMaskAnswer(this.fogSeat);
    this.lastFogKey = this.fogKey();
    this.post({
      kind: 'ready',
      ready: {
        delta,
        facts: this.lastFacts,
        fog,
        content: sim.content,
        mapFingerprint: sim.mapFingerprint,
        landscapeTypes: this.answers.landscapeTypes,
        missions: sim.missions,
        matchRules: sim.matchRules(),
        seed: sim.seed,
        maxStepsPerFrame: this.driver.maxStepsPerFrame,
        timeOrigin: performance.timeOrigin,
        buildMs,
        // The build's warnings land in this thread's ring, which no diagnostics report reads.
        log: diag.entries(),
        extras: built.extras,
      },
    });
  }

  /** Stop for good: the clock halts, pending answers reject, and nothing more is posted. */
  replace(): void {
    for (const id of this.answering) {
      this.post({
        kind: 'reply',
        id,
        tick: this.sim.tick,
        ok: false,
        error: wireError(new Error(REPLACED_SESSION_MESSAGE)),
      });
    }
    this.answering.clear();
    this.replaced = true;
    this.halt();
    this.deltas.close();
  }

  receive(message: ToWorker<unknown>): void {
    switch (message.kind) {
      case 'start':
        this.started = true;
        this.resume();
        return;
      case 'submit':
        this.driver.submit(message.envelope);
        return;
      case 'pause':
        this.driver.setPaused(message.paused);
        if (message.paused) this.halt();
        else this.resume();
        return;
      case 'speed':
        // Banks the time since the last step at the old pace before the new one applies.
        this.halt();
        this.stepNow();
        this.driver.setSpeed(message.speed);
        this.resume();
        return;
      case 'delivered':
        this.outbox.delivered(message.messages);
        this.resume();
        return;
      case 'fogSeat':
        this.fogSeat = message.player;
        this.postFogChange();
        return;
      case 'instruments':
        this.instrument(message.profile, message.spans);
        return;
      case 'profileReset':
        this.profile?.reset();
        return;
      case 'call':
        void this.answer(message.id, message.call);
        return;
      case 'boot':
      case 'ping':
        return;
    }
  }

  private post(message: FromWorker<E>, transfer?: readonly ArrayBuffer[]): void {
    if (!this.replaced) this.postToRuntime(message, transfer);
  }

  private canStep(): boolean {
    return (
      this.started &&
      !this.driver.paused &&
      !this.broken &&
      !this.replaced &&
      !this.running &&
      this.outbox.mayStep()
    );
  }

  /** Restart the clock after a hold; the time held is not owed. */
  private resume(): void {
    if (this.timer !== null || !this.canStep()) return;
    this.lastLoopMs = performance.now();
    this.schedule(0);
  }

  private halt(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const alpha = this.stepNow();
      // Aimed at the next tick's due time, which the timestep's leftover fraction gives, so a late
      // timer is made up by the next one rather than lost.
      if (alpha !== null && this.canStep()) {
        this.schedule(Math.max(0, ((1 - alpha) * MS_PER_TICK) / this.driver.speed));
      }
    }, delayMs);
  }

  /** Feed the time since the last step to the driver; null when the session cannot step now. */
  private stepNow(): number | null {
    if (!this.canStep()) return null;
    const nowMs = performance.now();
    const elapsedMs = nowMs - this.lastLoopMs;
    this.lastLoopMs = nowMs;
    this.stepStartMs = nowMs;
    try {
      return this.driver.advance(elapsedMs, this.stepped);
    } catch (err) {
      this.fail(err);
      return null;
    }
  }

  /** After every step, the driver's or `run`'s: record the tick and post it if the runtime has room. */
  private readonly stepped = (): void => {
    const simMs = performance.now() - this.stepStartMs;
    const { sim } = this;
    const tick = sim.tick;
    const events = sim.events.current();
    if (this.options.pauseOnSubMission && events.some((event) => event.kind === 'missionSubMission')) {
      this.driver.setPaused(true);
      this.halt();
    }
    const cadence = this.options.diagnostics ? diagCadenceAt(tick) : null;
    this.outbox.add({
      tick,
      // Posted now, the live list is cloned by the post; held back, it must outlive the next step.
      events: this.outbox.postsNow() ? events : cloneEvents(events),
      simMs,
      diagnostics:
        cadence === null
          ? null
          : { hash: sim.hashState(), violations: cadence.invariants ? sim.checkInvariants() : null },
    });
    this.stepStartMs = performance.now();
  };

  /** The records as one batch, its delta taken now: a delta is taken only for ticks a batch carries,
   *  since one taken and not posted would leave the mirror a gap. */
  private takeBatch(ticks: TickRecord[], shedTicks: number): TickBatch {
    const last = ticks[ticks.length - 1];
    const delta = this.deltas.next();
    if (last === undefined || delta === null) throw new Error('a batch needs a stepped tick');
    const facts = readWorldFacts(this.sim);
    const changed = changedFacts(this.lastFacts, facts);
    this.lastFacts = facts;
    const spans = this.spans;
    if (spans !== null) this.spans = [];
    return {
      delta: { ...delta, events: last.events },
      ticks,
      facts: changed,
      fog: this.fogChange(),
      droppedTicks: this.driver.droppedTicks,
      spans,
      shedTicks,
    };
  }

  private fogKey(): string {
    if (this.fogSeat === null) return 'none';
    const view = this.sim.fogView(this.fogSeat);
    return view === null ? 'off' : `${view.player}:${view.generation}`;
  }

  /** The seat's masks when they or the seat changed since the last post, else null. */
  private fogChange(): FogUpdate | null {
    const key = this.fogKey();
    if (key === this.lastFogKey) return null;
    this.lastFogKey = key;
    return { fog: this.fogSeat === null ? null : this.sim.fogMaskAnswer(this.fogSeat) };
  }

  private postFogChange(): void {
    const update = this.fogChange();
    if (update !== null) this.post({ kind: 'fog', update }, fogTransfer(update));
  }

  private instrument(profile: boolean, spans: boolean): void {
    this.profile = profile ? new SystemProfile() : null;
    this.spans = spans ? [] : null;
    const sink = spans
      ? (system: string, startMs: number, endMs: number): void => {
          this.spans?.push({ system, startMs, endMs });
        }
      : null;
    this.sim.setInstrument(profile || spans ? profiledInstrument(this.profile, sink) : null);
  }

  private async answer(id: number, call: WorkerCall): Promise<void> {
    this.answering.add(id);
    try {
      const value = await this.perform(call);
      if (this.answering.delete(id)) this.post({ kind: 'reply', id, tick: this.sim.tick, ok: true, value });
    } catch (err) {
      if (this.answering.delete(id)) {
        this.post({ kind: 'reply', id, tick: this.sim.tick, ok: false, error: wireError(err) });
      }
    }
  }

  private async perform(call: WorkerCall): Promise<unknown> {
    switch (call.method) {
      case 'host': {
        if (!isHostRequest(call.name)) throw new Error(`no host read named ${String(call.name)}`);
        // The name is checked above; the arguments are what the runtime typed against the same member.
        const read = this.answers[call.name] as (...args: readonly unknown[]) => Promise<unknown>;
        return read(...call.args);
      }
      case 'hashState':
        return { tick: this.sim.tick, hash: this.sim.hashState() };
      case 'run': {
        if (this.offClock === undefined) {
          throw new Error('this session steps only on its clock: no `run` outside it');
        }
        await this.run(this.offClock, call.ticks);
        return null;
      }
      case 'settle':
        return null;
      case 'captureSave':
        return this.driver.captureSave(call.options);
      case 'profileRows':
        return this.profile?.rows() ?? [];
    }
  }

  /** Step outside the session clock, paused or not. A command submitted while the run yields applies
   *  at the tick the session gave it. */
  private async run(offClock: OffClockRun, ticks: number): Promise<void> {
    this.running = true;
    this.halt();
    try {
      for (let done = 0; done < ticks; ) {
        const slice = Math.min(RUN_SLICE_TICKS, ticks - done);
        for (let i = 0; i < slice; i++) {
          this.stepStartMs = performance.now();
          offClock.step();
          this.stepped();
        }
        done += slice;
        if (done < ticks) await yieldToMessages();
        if (this.replaced) throw new Error(REPLACED_SESSION_MESSAGE);
      }
    } catch (err) {
      this.fail(err);
      throw err;
    } finally {
      this.running = false;
      this.resume();
    }
  }

  /** A tick threw: the world is past trusting, so the clock stops for good and the runtime rethrows. */
  private fail(err: unknown): void {
    // A replaced session's run ends by throwing; its world is no longer the runtime's.
    if (this.replaced) return;
    this.broken = true;
    this.halt();
    // The ticks before the failing one are the runtime's to deliver first, bound or not.
    this.outbox.flushAll();
    this.post({ kind: 'tickError', error: wireError(err) });
  }
}

function fogTransfer(update: FogUpdate | null): readonly ArrayBuffer[] {
  const buffer = update?.fog?.mask?.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}
