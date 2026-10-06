import {
  type GovernedClock,
  MAX_COMMANDS_PER_TICK,
  type PlayerWireEnvelope,
  type RelayWireEnvelope,
  TICK_MS,
  type WireCommand,
  type WireFrame,
} from '@open-northland/net-protocol';

/** Frames one advance may emit after a stall; past it the game runs late rather than sprinting. */
const MAX_FRAMES_PER_ADVANCE = 12;
/** Slack for elapsed sums that are whole ticks on paper and a rounding error short in floating point. */
const TIME_EPSILON_MS = 1e-6;
/** Bounds accepted future gestures even while paused. Unit count never changes their scheduled tick. */
export const MAX_PENDING_COMMANDS_PER_MEMBER = 128;
export const MAX_COMMAND_BYTES_PER_TICK = 1024 * 1024;
export const MAX_PENDING_COMMAND_BYTES = 2 * 1024 * 1024;

interface InputBudget {
  readonly count: number;
  readonly bytes: number;
}

export type ScheduleOutcome = { readonly applyTick: number } | { readonly refused: 'budget' };

/**
 * The room's tick clock: wall time scaled by the speed becomes frames, each carrying the commands
 * scheduled for its tick in the order they arrived. A pause is a member's choice; a hold is the
 * relay's, while it waits for a member, and the two are independent. A governed clock runs slower than
 * the requested speed, for a member that cannot keep up with it.
 */
export class RoomClock {
  private accumulatorMs = 0;
  private lastTick = 0;
  private started = false;
  private pausedFlag = false;
  private heldFlag = false;
  private speedMultiplier: number;
  private governedClock: GovernedClock | null = null;
  private readonly pending = new Map<number, WireCommand[]>();
  /** Per tick, the atomic gestures and serialized bytes each member has landed on it. */
  private readonly budgets = new Map<number, Map<string, InputBudget>>();
  private readonly lastScheduled = new Map<string, number>();
  private readonly pendingCounts = new Map<string, InputBudget>();

  constructor(speed: number) {
    this.speedMultiplier = speed;
  }

  /** The last tick emitted; every client can be at most here. */
  get tick(): number {
    return this.lastTick;
  }

  get nextTick(): number {
    return this.lastTick + 1;
  }

  get running(): boolean {
    return this.started;
  }

  /** The requested speed; frames come at the governed one while that is set. */
  get speed(): number {
    return this.speedMultiplier;
  }

  get governed(): GovernedClock | null {
    return this.governedClock;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  /** Stand at `tick` before the start: the tick every client's freshly built world already holds, so
   *  the first frame is the one after it. */
  startAt(tick: number): void {
    if (this.started) throw new Error('the clock has started');
    this.lastTick = tick;
  }

  /** Read-only queue view; callers publishing a snapshot must detach its envelopes. */
  pendingFrames(): readonly WireFrame[] {
    return [...this.pending].sort(([a], [b]) => a - b).map(([tick, commands]) => ({ tick, commands }));
  }

  finishAt(tick: number): void {
    this.lastTick = tick;
    this.pausedFlag = true;
    this.governedClock = null;
    this.accumulatorMs = 0;
    this.pending.clear();
    this.budgets.clear();
    this.lastScheduled.clear();
    this.pendingCounts.clear();
  }

  start(): void {
    this.started = true;
  }

  setSpeed(speed: number): void {
    this.speedMultiplier = speed;
  }

  setPaused(paused: boolean): void {
    this.pausedFlag = paused;
  }

  hold(held: boolean): void {
    this.heldFlag = held;
  }

  govern(governed: GovernedClock | null): void {
    this.governedClock = governed;
  }

  /**
   * Land an envelope `delayTicks` after the tick the member issued it on, or on the next unemitted tick
   * when the member's clock has fallen further behind than its budget. A client cannot have run a tick
   * this clock has not emitted, so a larger claim is clamped.
   */
  schedule(
    member: string,
    envelope: PlayerWireEnvelope,
    fromTick: number,
    delayTicks: number,
  ): ScheduleOutcome {
    const bytes = Buffer.byteLength(JSON.stringify(envelope));
    const pending = this.pendingCounts.get(member) ?? { count: 0, bytes: 0 };
    if (pending.count >= MAX_PENDING_COMMANDS_PER_MEMBER || pending.bytes + bytes > MAX_PENDING_COMMAND_BYTES)
      return { refused: 'budget' };
    const issued = Math.min(fromTick, this.lastTick);
    // A lower delay or a restored client tick must not let a later order overtake accepted input.
    const applyTick = Math.max(this.nextTick, issued + delayTicks, this.lastScheduled.get(member) ?? 0);
    const budget = this.budgets.get(applyTick) ?? new Map<string, InputBudget>();
    const used = budget.get(member) ?? { count: 0, bytes: 0 };
    // Refuse a whole gesture at the limit. Spilling it would make repeated input feel sticky.
    if (used.count >= MAX_COMMANDS_PER_TICK || used.bytes + bytes > MAX_COMMAND_BYTES_PER_TICK)
      return { refused: 'budget' };
    budget.set(member, { count: used.count + 1, bytes: used.bytes + bytes });
    this.budgets.set(applyTick, budget);
    this.lastScheduled.set(member, applyTick);
    this.pendingCounts.set(member, { count: pending.count + 1, bytes: pending.bytes + bytes });
    this.land(applyTick, envelope);
    return { applyTick };
  }

  /** Land the relay's own command on the next tick, outside every budget; returns that tick. */
  scheduleTrusted(envelope: RelayWireEnvelope): number {
    this.land(this.nextTick, envelope);
    return this.nextTick;
  }

  advance(elapsedMs: number): readonly WireFrame[] {
    if (!this.started || this.pausedFlag || this.heldFlag) return [];
    this.accumulatorMs += elapsedMs * (this.governedClock?.speed ?? this.speedMultiplier);
    const frames: WireFrame[] = [];
    while (this.accumulatorMs >= TICK_MS - TIME_EPSILON_MS && frames.length < MAX_FRAMES_PER_ADVANCE) {
      this.accumulatorMs -= TICK_MS;
      frames.push(this.emit());
    }
    if (this.accumulatorMs >= TICK_MS - TIME_EPSILON_MS) this.accumulatorMs = 0;
    return frames;
  }

  private land(tick: number, envelope: WireCommand['envelope']): void {
    const commands = this.pending.get(tick);
    if (commands === undefined) this.pending.set(tick, [{ envelope, sequence: 0 }]);
    else commands.push({ envelope, sequence: commands.length });
  }

  private emit(): WireFrame {
    const tick = ++this.lastTick;
    const commands = this.pending.get(tick) ?? [];
    this.pending.delete(tick);
    for (const [member, used] of this.budgets.get(tick) ?? []) {
      const pending = this.pendingCounts.get(member);
      if (pending !== undefined && pending.count > used.count)
        this.pendingCounts.set(member, {
          count: pending.count - used.count,
          bytes: pending.bytes - used.bytes,
        });
      else this.pendingCounts.delete(member);
      if (this.lastScheduled.get(member) === tick) this.lastScheduled.delete(member);
    }
    this.budgets.delete(tick);
    return { tick, commands };
  }
}
