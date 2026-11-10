import { BIT_MASK, WORD_SHIFT } from '../core/bit-words.js';
import type { Component, Entity } from './component.js';
import { ComponentStore } from './component-store.js';
import type { World } from './world.js';

/** Entity ids below this are marked in a dense bitset, a higher one in a set. */
const DENSE_MARK_LIMIT = 1 << 24;
const INITIAL_MARK_WORDS = 32;

/** What a derived view does with one entity's capture. */
export interface CaptureOps<C> {
  /** `e`'s live capture, or null when it contributes nothing. The only op that reads the world, since a
   *  withdrawal may replay after `e` was destroyed. `spent` is `e`'s capture just withdrawn, free to be
   *  refilled and returned instead of allocating a new one. */
  capture(e: Entity, spent: C | undefined): C | null;
  apply(e: Entity, captured: C): void;
  withdraw(e: Entity, captured: C): void;
  /** Forget everything applied, ahead of a full re-capture. */
  clear(): void;
}

/** The stores a capture reads: their membership changes, and the in-place value writes of `values`. */
export interface CaptureInputs {
  readonly membership: readonly Component<unknown>[];
  readonly values: readonly Component<unknown>[];
}

/**
 * Per-entity captures behind an incremental view, caught up by replaying the change journals of the
 * stores a capture reads, so a catch-up costs the entities that changed rather than the whole universe.
 * A journal gap re-captures the universe. A capture must read nothing outside its inputs; the view's
 * `verifyCaches` verifier is the tripwire when one does.
 */
export class JournaledCaptures<C> {
  /** A store rather than a `Map`: entities entering and leaving would have a map re-lay its table. */
  private held = new ComponentStore<C>();
  private readonly membershipGens = new Map<Component<unknown>, number>();
  private readonly valueGens = new Map<Component<unknown>, number>();
  /** The entities one catch-up replays, each once, in the order the journals first name them: the
   *  list's first `touchedCount` entries, the list keeping its storage across catch-ups. */
  private readonly touchedOrder: Entity[] = [];
  private touchedCount = 0;
  /** One bit per entity id, set while the entity is listed: a bit rather than a per-id stamp, since the
   *  ids ever allocated, not the live entities, size it. Cleared through the list after each catch-up.
   *  An id past {@link DENSE_MARK_LIMIT} (only a crafted save can name one) uses the set. */
  private marks = new Uint32Array(INITIAL_MARK_WORDS);
  private readonly sparseTouched = new Set<Entity>();
  /** {@link World.mutationVersion} at the last catch-up; any write to the world moves it on. */
  private caughtUpAt = -1;
  private readonly touch = (e: Entity): void => {
    if (e < DENSE_MARK_LIMIT) {
      const word = e >>> WORD_SHIFT;
      const bit = 1 << (e & BIT_MASK);
      if (word >= this.marks.length) this.growMarks(word);
      if ((this.marks[word] as number) & bit) return;
      this.marks[word] = (this.marks[word] as number) | bit;
    } else {
      if (this.sparseTouched.has(e)) return;
      this.sparseTouched.add(e);
    }
    if (this.touchedCount < this.touchedOrder.length) this.touchedOrder[this.touchedCount] = e;
    else this.touchedOrder.push(e);
    this.touchedCount++;
  };

  constructor(
    private readonly world: World,
    private readonly inputs: CaptureInputs,
    /** Every entity that may hold a capture, walked on a full re-capture. */
    private readonly universe: () => Iterable<Entity>,
    private readonly ops: CaptureOps<C>,
  ) {
    for (const c of inputs.membership) world.journalMembership(c);
    for (const c of inputs.values) world.journalValueWrites(c);
    this.rebuild();
  }

  /** Bring the captures up to the world as it stands. Free while the world has not been written since
   *  the last call, which is what most reads of one pass find. */
  catchUp(): void {
    // A difference rather than a comparison: the bytecode it saves keeps this small enough to be inlined
    // into every reader for free.
    if (this.world.mutationVersion - this.caughtUpAt) this.replay();
  }

  private replay(): void {
    const { world, inputs, touchedOrder } = this;
    this.caughtUpAt = world.mutationVersion;
    // Indexed: a frozen input list would cost a `for...of` an iterator result per component.
    for (let i = 0; i < inputs.membership.length; i++) {
      const c = inputs.membership[i] as Component<unknown>;
      const held = this.membershipGens.get(c) ?? 0;
      const now = world.componentGeneration(c);
      if (now === held) continue;
      if (!world.replayMembershipSince(c, held, this.touch)) {
        this.untouchAll();
        this.rebuild();
        return;
      }
      this.membershipGens.set(c, now);
    }
    for (let i = 0; i < inputs.values.length; i++) {
      const c = inputs.values[i] as Component<unknown>;
      const held = this.valueGens.get(c) ?? 0;
      const now = world.componentValueGeneration(c);
      if (now === held) continue;
      if (!world.replayValueWritesSince(c, held, this.touch)) {
        this.untouchAll();
        this.rebuild();
        return;
      }
      this.valueGens.set(c, now);
    }
    for (let i = 0; i < this.touchedCount; i++) this.refresh(touchedOrder[i] as Entity);
    this.untouchAll();
  }

  /** Empty the list, clearing the bit of every entity on it. */
  private untouchAll(): void {
    const { marks, touchedOrder } = this;
    for (let i = 0; i < this.touchedCount; i++) {
      const e = touchedOrder[i] as number;
      if (e >= DENSE_MARK_LIMIT) continue;
      const word = e >>> WORD_SHIFT;
      marks[word] = (marks[word] as number) & ~(1 << (e & BIT_MASK));
    }
    this.touchedCount = 0;
    this.sparseTouched.clear();
  }

  private growMarks(word: number): void {
    let length = this.marks.length * 2;
    while (length <= word) length *= 2;
    const grown = new Uint32Array(length);
    grown.set(this.marks);
    this.marks = grown;
  }

  private rebuild(): void {
    this.held = new ComponentStore<C>();
    this.ops.clear();
    for (const c of this.inputs.membership) this.membershipGens.set(c, this.world.componentGeneration(c));
    for (const c of this.inputs.values) this.valueGens.set(c, this.world.componentValueGeneration(c));
    for (const e of this.universe()) this.refresh(e);
  }

  /** Withdraw `e`'s held capture and apply its live one. Idempotent, so a journal naming `e` twice is
   *  harmless. */
  private refresh(e: Entity): void {
    const held = this.held.get(e);
    if (held !== undefined) this.ops.withdraw(e, held);
    const live = this.ops.capture(e, held);
    if (live === null) {
      if (held !== undefined) this.held.delete(e);
      return;
    }
    this.held.set(e, live);
    this.ops.apply(e, live);
  }
}
