import type { Command, Entity } from '@open-northland/sim';

export type DebugTargetKind = 'settler' | 'building';

export interface DebugAction {
  readonly id: 'kill' | 'satisfy' | 'starve' | 'fill' | 'finish';
  readonly targetKind: DebugTargetKind;
  readonly command: (target: Entity) => Command;
}

// Raw `debugSetNeeds` levels are the inverse of the buttons' satisfaction wording: 0 is sated, 100 starving.
const NEED_RAW_SATED = 0;
const NEED_RAW_MAXED = 100;

function setAllNeeds(target: Entity, rawPct: number): Command {
  return { kind: 'debugSetNeeds', target, hunger: rawPct, fatigue: rawPct, piety: rawPct, enjoyment: rawPct };
}

/** Listed in the panel's button order. */
export const DEBUG_ACTIONS: readonly DebugAction[] = [
  {
    id: 'kill',
    targetKind: 'settler',
    command: (target) => ({ kind: 'debugKill', target }),
  },
  {
    id: 'satisfy',
    targetKind: 'settler',
    command: (target) => setAllNeeds(target, NEED_RAW_SATED),
  },
  {
    id: 'starve',
    targetKind: 'settler',
    command: (target) => setAllNeeds(target, NEED_RAW_MAXED),
  },
  {
    id: 'fill',
    targetKind: 'building',
    command: (target) => ({ kind: 'debugFillStockpile', target }),
  },
  {
    id: 'finish',
    targetKind: 'building',
    command: (target) => ({ kind: 'debugCompleteConstruction', target }),
  },
];
