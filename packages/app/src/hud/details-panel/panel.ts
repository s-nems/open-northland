import type { PortraitInsetFrame } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import {
  buildUnitPanelModel,
  settlerStateHold,
  type UnitPanelModel,
  type UnitPanelModelContext,
} from './model/index.js';
import { createPanelRebuildGate } from './rebuild-gate.js';

/** A live cutout's rect, in on-screen px, plus the entity the observation window centres on. */
export type PortraitBox = PortraitInsetFrame;

export interface UnitPanelOptions extends UnitPanelModelContext {
  /** The screen the panels anchor to; a resize delivers the model again. */
  readonly screen: () => { readonly width: number; readonly height: number };
  /** Bumped when a sim read the model takes (the context's seams) lands anew. */
  readonly answersVersion?: () => number;
  /** Every model the rebuild gate lets through, for the DOM panels to show. */
  readonly onModel: (model: UnitPanelModel) => void;
}

/** Derives the selection's details model through the rebuild gate and hands it to the DOM panels. */
export interface UnitPanel {
  render(snapshot: WorldSnapshot, selected: ReadonlySet<number>): void;
  tick(snapshot: WorldSnapshot): void;
  /** The player issued a command from a panel on session tick `tick`: show its effect as soon as it lands. */
  commanded(tick: number): void;
}

export function createUnitPanel(opts: UnitPanelOptions): UnitPanel {
  const ctx: UnitPanelModelContext = { ...opts, holdSettlerState: settlerStateHold() };
  let selectedIds: ReadonlySet<number> = new Set();
  const gate = createPanelRebuildGate({
    derive: (snapshot) => buildUnitPanelModel(snapshot, selectedIds, ctx),
    now: () => performance.now(),
    ...(opts.answersVersion !== undefined ? { answersVersion: opts.answersVersion } : {}),
  });
  const update = (snapshot: WorldSnapshot, force: boolean): void => {
    const next = gate.decide(snapshot, opts.screen(), force);
    if (next === null) return;
    gate.rebuilt();
    opts.onModel(next.model);
  };
  return {
    render(snapshot, selected): void {
      selectedIds = new Set(selected);
      update(snapshot, true);
    },
    tick: (snapshot) => update(snapshot, false),
    commanded: (tick) => gate.commanded(tick),
  };
}
