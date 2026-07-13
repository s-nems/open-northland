import type { Command, Entity } from '@open-northland/sim';

/**
 * The DATA the admin/debug panel's **entity-action** tools offer — "arm a tool, click a target entity,
 * apply an effect". Kept apart from the panel wiring ({@link import('./index.js')}) so the catalog of
 * "what a debug click does" is one obvious, unit-testable table, the twin of {@link
 * import('./spawn-catalog.js')} for the spawn palette. Each action maps a picked entity to ONE debug
 * command through the sim's command seam (never an app-side reach into `sim.world`).
 */

/** Which kind of entity a click must land on for an action to apply (drives the entity pick + the noun in
 *  the armed hint). A settler action targets a unit; a building action targets a house/site/store. */
export type DebugTargetKind = 'settler' | 'building';

/** One armable debug action: its id/label, the entity kind it targets, and the command it issues there. */
export interface DebugAction {
  readonly id: string;
  readonly label: string;
  readonly targetKind: DebugTargetKind;
  /** The sim command this action enqueues at the picked entity `target`. */
  readonly command: (target: Entity) => Command;
}

// The button labels read as SATISFACTION (100% = full/rested, 0% = empty/starving), which is the INVERSE
// of the raw `debugSetNeeds` need level (0 = sated, ONE = maxed → the NeedsSystem's starvation/rest drive).
// So "Nasyć (100%)" drives every need to its raw MIN and "Zagłodź (0%)" to its raw MAX.
/** Raw need level for a fully SATED settler (satisfaction 100%). */
const NEED_RAW_SATED = 0;
/** Raw need level for a fully DEPLETED settler (satisfaction 0% — starving/exhausted). */
const NEED_RAW_MAXED = 100;

/** Set every need the sim tracks to one raw percent level — the payload the satisfy/starve tools share. */
function setAllNeeds(target: Entity, rawPct: number): Command {
  return { kind: 'debugSetNeeds', target, hunger: rawPct, fatigue: rawPct, piety: rawPct, enjoyment: rawPct };
}

/**
 * The debug actions the panel arms, each a click-a-target tool: kill a unit, drive its needs to full or
 * empty, fill a building's warehouse, or finish a construction site now. The order is the panel's button
 * order (unit actions first, then building actions).
 */
export const DEBUG_ACTIONS: readonly DebugAction[] = [
  {
    id: 'kill',
    label: 'Zabij jednostkę',
    targetKind: 'settler',
    command: (target) => ({ kind: 'debugKill', target }),
  },
  {
    id: 'satisfy',
    label: 'Nasyć potrzeby (100%)',
    targetKind: 'settler',
    command: (target) => setAllNeeds(target, NEED_RAW_SATED),
  },
  {
    id: 'starve',
    label: 'Zagłodź potrzeby (0%)',
    targetKind: 'settler',
    command: (target) => setAllNeeds(target, NEED_RAW_MAXED),
  },
  {
    id: 'fill',
    label: 'Napełnij magazyn',
    targetKind: 'building',
    command: (target) => ({ kind: 'debugFillStockpile', target }),
  },
  {
    id: 'finish',
    label: 'Dokończ budowę',
    targetKind: 'building',
    command: (target) => ({ kind: 'debugCompleteConstruction', target }),
  },
];
