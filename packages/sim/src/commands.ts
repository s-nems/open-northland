import type { Entity } from './ecs/world.js';

/**
 * Player commands are the ONLY way sim state mutates (CommandSystem applies them). They must be
 * serializable (a save is a command log; lockstep MP exchanges them) and exhaustively handled.
 *
 * This is a discriminated union, not a bag of methods or numeric opcodes — adding a variant forces
 * every handler's `switch` to acknowledge it (via assertNever), which is the modern guard against
 * the original's "magic number opcode" fragility. Grow this as Phase 2 systems land.
 */
export type Command =
  | {
      readonly kind: 'placeBuilding';
      readonly buildingType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
    }
  | {
      readonly kind: 'spawnSettler';
      readonly jobType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
    }
  | { readonly kind: 'setProduction'; readonly building: Entity; readonly goodType: number }
  | { readonly kind: 'demolish'; readonly building: Entity };

export type CommandKind = Command['kind'];

/**
 * A command stamped with the tick it is applied on. This is the unit of the **command log** — the
 * append-only record that IS the save format (replay the log from seed 0 to reach any state) and the
 * lockstep-multiplayer wire format (peers exchange `LoggedCommand`s, apply them on the same tick).
 * The log is built from tick 1 even before there's a disk format: the invariant ("the only way state
 * mutates is an applied command") is what matters now, not where the bytes land.
 */
export interface LoggedCommand {
  /** The tick on which CommandSystem applied this command (`Simulation.tick` at apply time). */
  readonly tick: number;
  readonly command: Command;
}

/**
 * The command queue — the single mutation seam into the sim. Player/UI/AI code (and a replaying save
 * loader) call {@link enqueue}; nothing else touches world state directly. Each tick CommandSystem
 * {@link drain}s the pending commands (in FIFO enqueue order — deterministic, no Map/Set iteration)
 * and applies them, appending each to the {@link log}. Determinism: the queue is a plain array, so
 * apply order is exactly enqueue order; two runs that enqueue the same commands on the same ticks
 * produce byte-identical state.
 */
export class CommandQueue {
  private pending: Command[] = [];
  private readonly applied: LoggedCommand[] = [];

  /** Queue a command to be applied on the next tick's CommandSystem pass. */
  enqueue(command: Command): void {
    this.pending.push(command);
  }

  /** Number of commands waiting to be applied (not yet drained). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Take and clear the pending commands (CommandSystem-only). Returns them in enqueue order; the
   * caller is responsible for recording each applied command via {@link record}.
   */
  drain(): readonly Command[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Append an applied command to the log (CommandSystem-only, after it applies the command). */
  record(tick: number, command: Command): void {
    this.applied.push({ tick, command });
  }

  /** The append-only command log — the save / replay / lockstep record. Read-only to consumers. */
  get log(): readonly LoggedCommand[] {
    return this.applied;
  }
}

/**
 * The effect an atomic action applies on completion. Keeps the numeric `atomicId` as the content
 * cross-reference (required for fidelity), but the EFFECT a system applies is a typed union so the
 * AtomicSystem's apply switch is exhaustive and golden traces are human-readable, not opaque ints.
 */
export type AtomicEffect =
  | { readonly kind: 'move'; readonly to: { x: number; y: number } }
  | { readonly kind: 'harvest'; readonly resource: Entity; readonly goodType: number }
  | {
      readonly kind: 'pickup';
      readonly goodType: number;
      readonly amount: number;
      /** The store the goods come OUT of (a workplace's stockpile a carrier hauls from), or null
       *  for a sourceless pickup (the goods appear on the settler's back without a source). Goods
       *  are conserved: a pickup `from` a store removes exactly what it adds to the carrier. */
      readonly from: Entity | null;
    }
  | { readonly kind: 'pileup'; readonly store: Entity }
  | { readonly kind: 'produce'; readonly recipeOutput: number }
  | {
      readonly kind: 'eat';
      readonly goodType: number;
      /** The store the food is consumed FROM (a stockpile the eater stands on), or null when the
       *  eater consumes a unit it already carries. One unit of `goodType` is removed on completion —
       *  eating destroys the food (it is conserved up to that consumption: nothing is conjured). */
      readonly from: Entity | null;
    }
  /** The settler sleeps to restore rest: zeroes its `fatigue` on completion (no goods consumed —
   *  unlike `eat`, resting is free). The pairing reset for the NeedsSystem's fatigue rise. */
  | { readonly kind: 'sleep' }
  /** The settler prays to restore devotion: zeroes its `piety` on completion (no goods consumed —
   *  like `sleep`, praying is free). The pairing reset for the NeedsSystem's piety rise. Unlike
   *  `sleep` (in place) this is the first **target-bound** need — the settler must stand on a temple
   *  to run it (the planner walks it there first). */
  | { readonly kind: 'pray' }
  | { readonly kind: 'attack'; readonly target: Entity }
  | { readonly kind: 'idle' };

export type AtomicEffectKind = AtomicEffect['kind'];
