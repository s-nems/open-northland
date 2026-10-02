import type { Component, Entity } from './component.js';
import type { World } from './world.js';

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
  /** The entities one catch-up replays, reused across catch-ups. */
  private readonly touched = new Set<Entity>();

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
    const { world, inputs, touched } = this;
    touched.clear();
    for (const c of inputs.membership) {
      const held = this.membershipGens.get(c) ?? 0;
      const now = world.componentGeneration(c);
      if (now !== held && !this.collect(this.membershipGens, c, now, world.membershipDeltasSince(c, held))) {
        this.rebuild();
        return;
      }
    }
    for (const c of inputs.values) {
      const held = this.valueGens.get(c) ?? 0;
      const now = world.componentValueGeneration(c);
      if (now !== held && !this.collect(this.valueGens, c, now, world.valueWritesSince(c, held))) {
        this.rebuild();
        return;
      }
    }
    for (const e of touched) this.refresh(e);
    touched.clear();
  }

  /** Add the entities a journal names since the held generation; false on a journal gap. */
  private collect(
    gens: Map<Component<unknown>, number>,
    c: Component<unknown>,
    now: number,
    deltas: readonly Entity[] | null,
  ): boolean {
    if (deltas === null) return false;
    for (const e of deltas) this.touched.add(e);
    gens.set(c, now);
    return true;
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
