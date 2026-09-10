import {
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

export type ScheduleOutcome = { readonly applyTick: number } | { readonly refused: 'budget' };

/**
 * The room's tick clock: wall time scaled by the speed becomes frames, each carrying the commands
 * scheduled for its tick in the order they arrived. A pause is a member's choice; a hold is the
 * relay's, while it waits for a member, and the two are independent.
 */
export class RoomClock {
  private accumulatorMs = 0;
  private lastTick = 0;
  private started = false;
  private pausedFlag = false;
  private heldFlag = false;
  private speedMultiplier: number;
  private readonly pending = new Map<number, WireCommand[]>();
  /** Per tick, how many commands each member has landed on it. */
  private readonly budgets = new Map<number, Map<string, number>>();

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

  get speed(): number {
    return this.speedMultiplier;
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
    const issued = Math.min(fromTick, this.lastTick);
    const applyTick = Math.max(this.nextTick, issued + delayTicks);
    const budget = this.budgets.get(applyTick) ?? new Map<string, number>();
    const used = budget.get(member) ?? 0;
    if (used >= MAX_COMMANDS_PER_TICK) return { refused: 'budget' };
    budget.set(member, used + 1);
    this.budgets.set(applyTick, budget);
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
    this.accumulatorMs += elapsedMs * this.speedMultiplier;
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
    this.budgets.delete(tick);
    return { tick, commands };
  }
}
