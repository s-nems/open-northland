import type { WorldSnapshot } from '@open-northland/sim';
import type { UnitPanelModel } from './model/index.js';

/** Minimum wall-clock gap in ms between value-driven rebuilds; selection changes rebuild immediately. */
const VALUE_REBUILD_MIN_MS = 250;

export interface PanelRebuild {
  readonly model: UnitPanelModel;
  /** The selection itself changed, not just its live values. */
  readonly structural: boolean;
}

export interface PanelRebuildGate {
  /** The rebuild this snapshot calls for, or null to keep the current bake; `force` re-derives the model
   *  and always rebuilds structurally. */
  decide(
    snapshot: WorldSnapshot,
    screen: { readonly width: number; readonly height: number },
    force: boolean,
  ): PanelRebuild | null;
  /** Report a rebuild the gate did not decide, which restarts the throttle window. */
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
    case 'palisade':
      return `${model.kind}:${model.entityId}`;
    case 'empty':
    case 'multi-settler':
    case 'generic':
      return model.kind;
  }
};

/** Gates the panel's model re-derive and re-bake: `decide` runs every frame while the O(entities) model
 *  build and the bake must not. */
export function createPanelRebuildGate(deps: PanelRebuildGateDeps): PanelRebuildGate {
  /** Keyed on snapshot identity, not `snapshot.tick`: a same-tick world mutation hands out a new snapshot
   *  object under an unchanged tick, and a paused tick never advances to heal a stale model. */
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
      // The screen size joins the value key so a resize re-anchors the panel.
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
