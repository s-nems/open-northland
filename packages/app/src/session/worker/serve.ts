import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
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

/** What a world builder hands the worker: the sim it runs, and plain data the runtime reads once. */
export interface HostedBuild<E> {
  readonly sim: Simulation;
  readonly extras: E;
}

export type WorldBuilder<B, E> = (boot: B) => HostedBuild<E>;

/**
 * Tick batches posted and not yet delivered past which the worker keeps stepping but holds its ticks
 * back, so the next batch spans them. Two lets one batch wait in the runtime's queue while the next is
 * already on its way.
 */
export const TICK_BATCHES_IN_FLIGHT = 2;

/**
 * Session time the worker may run past the last tick the runtime delivered before it holds its clock.
 * A runtime that stops drawing, such as a hidden tab, would otherwise have the worker bank every tick's
 * events without bound; a slow frame shorter than this costs no ticks.
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

/** Serve one session on `port`: build its world from the first `boot` message, then run it. */
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
      if (session !== null) return;
      const startMs = performance.now();
      try {
        const built = build(message.boot);
        session = new ServedSession(post, built, message.options, performance.now() - startMs);
      } catch (err) {
        post({ kind: 'bootFailed', error: wireError(err), log: diag.entries() });
      }
      return;
    }
    session?.receive(message);
  });
}

type Post<E> = (message: FromWorker<E>, transfer?: readonly ArrayBuffer[]) => void;

/** The worker's side of a running session: its sim, driver, clock and the batches it owes the runtime. */
class ServedSession<E> {
  private readonly sim: Simulation;
  private readonly driver: LockstepDriver;
  private readonly deltas: SnapshotDeltaStream;
  /** Answers the request-shaped reads as the inline host does, over this thread's sim. */
  private readonly answers: SessionHost;
  private readonly options: WorkerSessionOptions;
  private readonly transport = new LoopbackTransport();
  /** Stepped ticks no batch carries yet. */
  private pending: TickRecord[] = [];
  /** Batches taken while the runtime had no room, oldest first: each spans at most
   *  {@link maxTicksPerBatch} ticks, so the runtime can deliver them a frame's worth at a time. */
  private readonly held: TickBatch[] = [];
  /** Per batch posted and not yet delivered, its tick count, oldest first. */
  private readonly inFlight: number[] = [];
  private undeliveredTicks = 0;
  private lastFacts: WorldFacts;
  private fogSeat: number | null;
  private lastFogKey: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastLoopMs = performance.now();
  private stepStartMs = 0;
  private started = false;
  private running = false;
  private broken = false;
  private profile: SystemProfile | null = null;
  private spans: SystemSpan[] | null = null;

  constructor(
    private readonly post: Post<E>,
    built: HostedBuild<E>,
    options: WorkerSessionOptions,
    buildMs: number,
  ) {
    const { sim } = built;
    this.sim = sim;
    this.options = options;
    this.driver = new LockstepDriver({
      sim,
      transport: this.transport,
      speed: options.speed,
      paused: options.paused,
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
    post({
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
        this.delivered(message.messages);
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

  private delivered(messages: number): void {
    for (let i = 0; i < messages; i++) this.undeliveredTicks -= this.inFlight.shift() ?? 0;
    while (this.hasRoom() && (this.held.length > 0 || this.pending.length > 0)) this.flush();
    this.resume();
  }

  private hasRoom(): boolean {
    return this.inFlight.length < TICK_BATCHES_IN_FLIGHT;
  }

  /** The runtime delivers at most a frame's worth of ticks per frame, the inline driver's step cap. */
  private get maxTicksPerBatch(): number {
    return this.driver.maxStepsPerFrame;
  }

  private canStep(): boolean {
    return (
      this.started &&
      !this.driver.paused &&
      !this.broken &&
      !this.running &&
      this.undeliveredTicks + this.heldTicks() + this.pending.length < undeliveredTickLimit(this.driver.speed)
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
    const room = this.hasRoom() && this.held.length === 0;
    this.pending.push({
      tick,
      // Posted now, the live list is cloned by the post; held back, it must outlive the next step.
      events: room ? events : cloneEvents(events),
      simMs,
      diagnostics:
        cadence === null
          ? null
          : { hash: sim.hashState(), violations: cadence.invariants ? sim.checkInvariants() : null },
    });
    if (room) this.flush();
    else if (this.pending.length >= this.maxTicksPerBatch) this.held.push(this.takeBatch());
    this.stepStartMs = performance.now();
  };

  /** Post the oldest held batch, or one over the pending ticks. */
  private flush(): void {
    const batch = this.held.shift() ?? (this.pending.length > 0 ? this.takeBatch() : null);
    if (batch === null) return;
    this.inFlight.push(batch.ticks.length);
    this.undeliveredTicks += batch.ticks.length;
    this.post({ kind: 'ticks', batch }, fogTransfer(batch.fog));
  }

  private heldTicks(): number {
    let ticks = 0;
    for (const batch of this.held) ticks += batch.ticks.length;
    return ticks;
  }

  /** The pending ticks as one batch, its delta taken now: a delta is taken only for ticks a batch
   *  carries, since one taken and not posted would leave the mirror a gap. */
  private takeBatch(): TickBatch {
    const ticks = this.pending;
    const last = ticks[ticks.length - 1];
    const delta = this.deltas.next();
    if (last === undefined || delta === null) throw new Error('a batch needs a stepped tick');
    this.pending = [];
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
    try {
      const value = await this.perform(call);
      this.post({ kind: 'reply', id, tick: this.sim.tick, ok: true, value });
    } catch (err) {
      this.post({ kind: 'reply', id, tick: this.sim.tick, ok: false, error: wireError(err) });
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
      case 'run':
        await this.run(call.ticks);
        return null;
      case 'settle':
        return null;
      case 'captureSave':
        return this.driver.captureSave(call.options);
      case 'profileRows':
        return this.profile?.rows() ?? [];
    }
  }

  /** Step outside the session clock, paused or not. Each tick still takes its frame from the
   *  transport, so a command submitted while the run yields applies at the tick it was given. */
  private async run(ticks: number): Promise<void> {
    this.running = true;
    this.halt();
    try {
      for (let done = 0; done < ticks; ) {
        const slice = Math.min(RUN_SLICE_TICKS, ticks - done);
        for (let i = 0; i < slice; i++) {
          this.stepStartMs = performance.now();
          const tick = this.sim.tick + 1;
          for (const command of this.transport.take(tick).commands) {
            this.sim.enqueueAt(command.envelope, tick, command.sequence);
          }
          this.sim.step();
          this.stepped();
        }
        done += slice;
        if (done < ticks) await yieldToMessages();
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
    this.broken = true;
    this.halt();
    // The ticks before the failing one are the runtime's to deliver first, bound or not.
    while (this.held.length > 0 || this.pending.length > 0) this.flush();
    this.post({ kind: 'tickError', error: wireError(err) });
  }
}

function fogTransfer(update: FogUpdate | null): readonly ArrayBuffer[] {
  const buffer = update?.fog?.mask?.buffer;
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}
