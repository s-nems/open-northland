import type { WorldSnapshot } from '@open-northland/sim';
import type { UnitPanelModel } from './model/index.js';

/**
 * Minimum wall-clock gap between value-driven rebuilds. Live values (production %, need bars, status
 * countdowns) change nearly every sim tick; rebuilding the retained tree 20×/s is pure churn, and 4 Hz
 * is indistinguishable on a ~100-px bar. Selection changes rebuild immediately.
 */
const VALUE_REBUILD_MIN_MS = 250;

export interface PanelRebuild {
  readonly model: UnitPanelModel;
  /** The selection itself changed, not just its live values. */
  readonly structural: boolean;
}

export interface PanelRebuildGate {
  /** The rebuild this snapshot calls for, or null to keep the current bake. `force` (the selection
   *  changed under the gate) re-derives the model and always rebuilds structurally. */
  decide(
    snapshot: WorldSnapshot,
    screen: { readonly width: number; readonly height: number },
    force: boolean,
  ): PanelRebuild | null;
  /** Report a rebuild the gate did not decide (a hover or stock-tab press re-bakes the current model):
   *  the throttle limits rebuilds, so those restart its window too. */
  rebuilt(): void;
}

export interface PanelRebuildGateDeps {
  /** Build the panel model for a snapshot against the caller's current selection. */
  readonly derive: (snapshot: WorldSnapshot) => UnitPanelModel;
  /** Wall clock in ms, the value throttle's only time source. */
  readonly now: () => number;
}

const structureKeyOf = (model: UnitPanelModel): string => {
  switch (model.kind) {
    case 'building':
    case 'settler':
    case 'signpost':
      return `${model.kind}:${model.entityId}`;
    case 'empty':
    case 'multi-settler':
    case 'generic':
      return model.kind;
  }
};

/**
 * When the details panel re-derives its model and re-bakes its texture. `decide` runs every RAF frame
 * (~3 per 20 Hz sim tick) while the O(entities) model build and the bake must not.
 */
export function createPanelRebuildGate(deps: PanelRebuildGateDeps): PanelRebuildGate {
  /** Keyed on snapshot IDENTITY, not `snapshot.tick`: the sim memoizes `snapshot()` on tick + world
   *  mutation version, so a same-tick mutation hands out a new object under an unchanged tick, and while
   *  paused the tick never advances to heal a stale model. */
  let derived: { snapshot: WorldSnapshot; model: UnitPanelModel; json: string } | null = null;
  let lastModelKey = '';
  let lastStructureKey = '';
  let lastRebuildAt = Number.NEGATIVE_INFINITY;

  const modelFor = (snapshot: WorldSnapshot, force: boolean): { model: UnitPanelModel; json: string } => {
    if (!force && derived !== null && derived.snapshot === snapshot) return derived;
    const model = deps.derive(snapshot);
    derived = { snapshot, model, json: JSON.stringify(model) };
    return derived;
  };

  return {
    decide(snapshot, screen, force): PanelRebuild | null {
      const { model, json } = modelFor(snapshot, force);
      // A whole-model value key (plus the screen size, so a resize re-anchors the panel): the panel is
      // small, so stringify-compare beats hand-written dirty flags.
      const key = `${json}|${screen.width}x${screen.height}`;
      if (!force && key === lastModelKey) return null;
      const structureKey = structureKeyOf(model);
      const structural = force || structureKey !== lastStructureKey;
      // A refused change keeps the old keys, so a later frame of the same tick still rebuilds it.
      if (!structural && deps.now() - lastRebuildAt < VALUE_REBUILD_MIN_MS) return null;
      lastModelKey = key;
      lastStructureKey = structureKey;
      return { model, structural };
    },
    rebuilt(): void {
      lastRebuildAt = deps.now();
    },
  };
}
