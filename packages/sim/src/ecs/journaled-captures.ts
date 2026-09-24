import type { Component, Entity } from './component.js';
import type { World } from './world.js';

/** What a derived view does with one entity's capture. */
export interface CaptureOps<C> {
  /** `e`'s live capture, or null when it contributes nothing. The only op that reads the world, since a
   *  withdrawal may replay after `e` was destroyed. */
  capture(e: Entity): C | null;
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
    const touched = new Set<Entity>();
    const { world } = this;
    const complete =
      this.inputs.membership.every((c) =>
        collect(touched, this.membershipGens, c, world.componentGeneration(c), (since) =>
          world.membershipDeltasSince(c, since),
        ),
      ) &&
      this.inputs.values.every((c) =>
        collect(touched, this.valueGens, c, world.componentValueGeneration(c), (since) =>
          world.valueWritesSince(c, since),
        ),
      );
    if (!complete) {
      this.rebuild();
      return;
    }
    for (const e of touched) this.refresh(e);
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
    if (held !== undefined) {
      this.ops.withdraw(e, held);
      this.held.delete(e);
    }
    const live = this.ops.capture(e);
    if (live === null) return;
    this.held.set(e, live);
    this.ops.apply(e, live);
  }
}

/** Add the entities `c`'s journal names since the held generation; false on a journal gap. */
function collect(
  touched: Set<Entity>,
  gens: Map<Component<unknown>, number>,
  c: Component<unknown>,
  now: number,
  deltasSince: (since: number) => readonly Entity[] | null,
): boolean {
  const held = gens.get(c) ?? 0;
  if (now === held) return true;
  const deltas = deltasSince(held);
  if (deltas === null) return false;
  for (const e of deltas) touched.add(e);
  gens.set(c, now);
  return true;
}
