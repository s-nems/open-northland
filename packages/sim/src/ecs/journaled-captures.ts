import type { Component, Entity } from './component.js';
import type { World } from './world.js';

/** Entity ids below this are stamped in a dense array, a higher one in a set. */
const DENSE_STAMP_LIMIT = 1 << 24;
const INITIAL_STAMPS = 1024;

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
  private readonly held = new Map<Entity, C>();
  private readonly membershipGens = new Map<Component<unknown>, number>();
  private readonly valueGens = new Map<Component<unknown>, number>();
  /** The entities one catch-up replays, each once, in the order the journals first name them: the
   *  list's first `touchedCount` entries, the list keeping its storage across catch-ups. */
  private readonly touchedOrder: Entity[] = [];
  private touchedCount = 0;
  /** Per entity id, the catch-up that last listed it; a clear and a regrown set would allocate per
   *  catch-up. An id past {@link DENSE_STAMP_LIMIT} (only a crafted save can name one) uses the set. */
  private stamps = new Int32Array(INITIAL_STAMPS);
  private readonly sparseTouched = new Set<Entity>();
  private epoch = 0;
  private readonly touch = (e: Entity): void => {
    if (e < DENSE_STAMP_LIMIT) {
      if (e >= this.stamps.length) this.growStamps(e);
      if (this.stamps[e] === this.epoch) return;
      this.stamps[e] = this.epoch;
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

  catchUp(): void {
    const { world, inputs, touchedOrder } = this;
    this.epoch++;
    this.touchedCount = 0;
    this.sparseTouched.clear();
    // Indexed: a frozen input list would cost a `for...of` an iterator result per component.
    for (let i = 0; i < inputs.membership.length; i++) {
      const c = inputs.membership[i] as Component<unknown>;
      const held = this.membershipGens.get(c) ?? 0;
      const now = world.componentGeneration(c);
      if (now === held) continue;
      if (!world.replayMembershipSince(c, held, this.touch)) {
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
        this.rebuild();
        return;
      }
      this.valueGens.set(c, now);
    }
    for (let i = 0; i < this.touchedCount; i++) this.refresh(touchedOrder[i] as Entity);
    this.touchedCount = 0;
  }

  private growStamps(e: Entity): void {
    let length = this.stamps.length * 2;
    while (length <= e) length *= 2;
    const grown = new Int32Array(Math.min(length, DENSE_STAMP_LIMIT));
    grown.set(this.stamps);
    this.stamps = grown;
  }

  private rebuild(): void {
    this.held.clear();
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
