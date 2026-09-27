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
  /** The driver may step nothing while it waits for another authority's frames; its session then
   *  polls at {@link IDLE_POLL_TICKS} until `wake`. */
  readonly awaitsFrames?: boolean;
  /** Where a driver that reports its own load learns the tick costs its `advance` does not see. */
  readonly costs?: TickCostSink;
}

/** The tick costs a session's driver cannot measure itself. */
export interface TickCostSink {
  /** Worker time spent on stepped ticks outside the driver's `advance`: taking and posting a batch. */
  charge(ms: number): void;
  /** The wall time a tick costs the runtime, per frame that delivered `ticks`: the frame interval over
   *  the most ticks one frame takes in on average. */
  drawn(ms: number, ticks: number): void;
}

export type WorldBuilder<B, E> = (boot: B, options: WorkerSessionOptions) => HostedBuild<E>;

/** The runtime's frames a worker may step past the delivered tick: a batch posted on one
 *  frame's acknowledgement is drawn on the next, so the worker steps one frame ahead of the batch in
 *  flight. */
const LEAD_FRAMES = 2;

/** Wall time on top of the lead's frames, so a frame late by a garbage collection costs no ticks. */
const LEAD_GRACE_MS = 50;

/** The longest frame the lead grows with. Past it the clock slows with the frame rate, as the inline
 *  driver's per-frame step cap slows it. */
const MAX_LEAD_FRAME_MS = 250;

/** Whole ticks on top of the lead's time: the batch in flight holds at least one, and a slow speed's
 *  lead of under two would stop the clock behind it until the next delivery. */
const LEAD_SPARE_TICKS = 1;

/** The frame interval a worker assumes until the runtime reports its first. */
export const ASSUMED_FRAME_MS = 1000 / 60;

/** The ticks a worker may step past the runtime's delivered tick, at a session speed and the
 *  runtime's last frame interval. */
export function leadTickLimit(speed: number, frameMs: number): number {
  const leadMs = LEAD_FRAMES * Math.min(frameMs, MAX_LEAD_FRAME_MS) + LEAD_GRACE_MS;
  return Math.ceil((leadMs / 1000) * TICKS_PER_SECOND * speed) + LEAD_SPARE_TICKS;
}

/** A waiting driver's poll period, in tick periods at the session speed. A frame's arrival wakes the
 *  session at once, so this only bounds how often a driver that holds no frame is asked again. */
export const IDLE_POLL_TICKS = 0.5;

/** Ticks `run` steps between yields, so heartbeats and deliveries are answered during a long run. */
const RUN_SLICE_TICKS = 10;

const NO_EVENTS: readonly SimEvent[] = [];

const yieldToMessages = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Run `task` as a task of its own, behind the messages already received. A zero-delay timer would do
 *  the same, but browsers delay a chain of them by 4 ms each, which a sim stepping on at once pays per
 *  tick. Returns the cancel. */
function nextTask(task: () => void): () => void {
  let live = true;
  const { port1, port2 } = new MessageChannel();
  port1.onmessage = () => {
    port1.close();
    if (live) task();
  };
  port2.postMessage(null);
  return () => {
    live = false;
  };
}

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
  private readonly awaitsFrames: boolean;
  private readonly costs: TickCostSink | undefined;
  private readonly deltas: SnapshotDeltaStream;
  /** Answers the request-shaped reads as the inline host does, over this thread's sim. */
  private readonly answers: SessionHost;
  private readonly options: WorkerSessionOptions;
  private readonly outbox: TickOutbox;
  /** The runtime's last reported frame interval. */
  private frameMs = ASSUMED_FRAME_MS;
  /** Wall time the clock owes the driver and has not fed it yet. */
  private owedMs = 0;
  /** Session time the clock wrote off because the sim could not keep up with it. */
  private droppedMs = 0;
  /** The calls being answered; a replacement rejects them. */
  private readonly answering = new Set<number>();
  private lastFacts: WorldFacts;
  private fogSeat: number | null;
  private lastFogKey: string;
  /** Cancels the pending wakeup; null while none is pending. */
  private cancelWakeup: (() => void) | null = null;
  /** The pending wakeup is a waiting driver's poll, which `wake` cuts short. */
  private polling = false;
  /** Every tick stepped, for telling an advance that stepped none. */
  private steppedTicks = 0;
  /** The last tick the outbox holds a record of: a failure names the tick after it. */
  private recordedTick: number;
  /** Advances in a row that stepped no tick. */
  private idleAdvances = 0;
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
    this.awaitsFrames = built.awaitsFrames === true;
    this.costs = built.costs;
    this.outbox = new TickOutbox({
      take: (records, leadTicks) => this.takeBatch(records, leadTicks),
      post: (batch) => this.post({ kind: 'ticks', batch }, fogTransfer(batch.fog)),
      limit: () => leadTickLimit(this.driver.speed, this.frameMs),
    });
    this.answers = inlineSessionHost(sim, { snapshots: 'live' });
    // Without the events: each tick's record carries its own, so the stream's clone would be dropped.
    this.deltas = new SnapshotDeltaStream(
      {
        world: sim.world,
        get tick() {
          return sim.tick;
        },
        events: { current: () => NO_EVENTS },
      },
      { digest: options.diagnostics },
    );
    this.fogSeat = options.fogSeat;
    this.recordedTick = sim.tick;
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
        // Banks the time since the last step at the old pace before the new one applies. What a sim
        // behind its clock still owes is written off, so a slower clock replays none of the faster.
        this.halt();
        this.stepNow();
        this.writeOff(this.owedMs);
        this.driver.setSpeed(message.speed);
        this.resume();
        return;
      case 'delivered': {
        this.frameMs = message.frameMs;
        const flushStartMs = performance.now();
        const ticks = this.outbox.delivered(message.messages);
        this.costs?.charge(performance.now() - flushStartMs);
        // The batch in flight and the ticks stepped behind it share one lead, so two frames take in one
        // lead's ticks between them.
        const leadMs = this.frameMs * LEAD_FRAMES;
        this.costs?.drawn(leadMs / leadTickLimit(this.driver.speed, this.frameMs), ticks);
        this.resume();
        return;
      }
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

  /** What a waiting driver waited on may have arrived: a pending poll steps now. */
  wake(): void {
    if (this.cancelWakeup === null || !this.polling) return;
    this.halt();
    this.schedule(0);
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
    if (this.cancelWakeup !== null || !this.canStep()) return;
    this.lastLoopMs = performance.now();
    this.schedule(0);
  }

  private halt(): void {
    this.cancelWakeup?.();
    this.cancelWakeup = null;
  }

  private schedule(delayMs: number, polling = false): void {
    this.polling = polling;
    const wake = (): void => {
      this.cancelWakeup = null;
      const before = this.steppedTicks;
      const alpha = this.stepNow();
      if (alpha === null || !this.canStep()) return;
      this.idleAdvances = this.steppedTicks === before ? this.idleAdvances + 1 : 0;
      const tickMs = MS_PER_TICK / this.driver.speed;
      // A second advance in a row that stepped nothing is a driver waiting or paused, whose leftover
      // fraction says nothing of when to ask again; one alone may be a timer that fired a hair early.
      if (this.awaitsFrames && this.idleAdvances > 1) this.schedule(IDLE_POLL_TICKS * tickMs, true);
      // A sim behind its clock steps on once the messages that came meanwhile are answered.
      else if (this.owedMs > 0) this.schedule(0);
      // Aimed at the next tick's due time, which the timestep's leftover fraction gives, so a late
      // timer is made up by the next one rather than lost.
      else this.schedule((1 - alpha) * tickMs);
    };
    if (delayMs > 0) {
      const timer = setTimeout(wake, delayMs);
      this.cancelWakeup = () => clearTimeout(timer);
    } else {
      this.cancelWakeup = nextTask(wake);
    }
  }

  /**
   * Feed the driver the time since the last step, at most a tick's worth at a time, so pause, speed and
   * the runtime's deliveries are answered between ticks. Null when the session cannot step now.
   */
  private stepNow(): number | null {
    if (!this.canStep()) return null;
    const nowMs = performance.now();
    const tickMs = MS_PER_TICK / this.driver.speed;
    this.owedMs += nowMs - this.lastLoopMs;
    this.lastLoopMs = nowMs;
    // A sim slower than its clock owes more with each tick it steps: past a frame's cap of ticks the
    // rest is written off, and the clock slows to what the sim delivers.
    this.writeOff(this.owedMs - this.driver.maxStepsPerFrame * tickMs);
    const feedMs = Math.min(this.owedMs, tickMs);
    this.owedMs -= feedMs;
    this.stepStartMs = nowMs;
    const before = this.steppedTicks;
    try {
      const alpha = this.driver.advance(feedMs, this.stepped);
      // A driver that stepped nothing holds, as its timestep does, what it is owed while it waits.
      if (this.steppedTicks === before) this.owedMs = 0;
      return alpha;
    } catch (err) {
      this.fail(err);
      return null;
    }
  }

  /** Drop this much of the wall time owed, counted as dropped ticks. */
  private writeOff(ms: number): void {
    if (ms <= 0) return;
    this.droppedMs += ms * this.driver.speed;
    this.owedMs -= ms;
  }

  /** After every step, the driver's or `run`'s: record the tick and post it if the runtime has room. */
  private readonly stepped = (): void => {
    this.steppedTicks++;
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
    this.recordedTick = tick;
    this.stepStartMs = performance.now();
  };

  /** The records as one batch, its delta taken now: a delta is taken only for ticks a batch carries,
   *  since one taken and not posted would leave the mirror a gap. */
  private takeBatch(ticks: TickRecord[], leadTicks: number): TickBatch {
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
      droppedTicks: this.driver.droppedTicks + Math.round(this.droppedMs / MS_PER_TICK),
      spans,
      leadTicks,
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
    let value: unknown;
    try {
      value = await this.perform(call);
    } catch (err) {
      if (this.answering.delete(id)) this.replyFailed(id, err);
      return;
    }
    if (!this.answering.delete(id)) return;
    try {
      this.post({ kind: 'reply', id, tick: this.sim.tick, ok: true, value });
    } catch (err) {
      // An answer the port cannot clone still settles the runtime's ask.
      this.replyFailed(id, err);
    }
  }

  private replyFailed(id: number, err: unknown): void {
    this.post({ kind: 'reply', id, tick: this.sim.tick, ok: false, error: wireError(err) });
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
    // A delta taken now would carry the failing tick's partial writes under its advanced tick, so the
    // ticks no batch carries yet are never posted: the runtime keeps the last whole tick it was sent.
    this.outbox.abandon();
    this.post({ kind: 'tickError', tick: this.recordedTick + 1, error: wireError(err) });
  }
}

function fogTransfer(update: FogUpdate | null): readonly ArrayBuffer[] {
  const buffer = update?.fog?.mask?.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}
