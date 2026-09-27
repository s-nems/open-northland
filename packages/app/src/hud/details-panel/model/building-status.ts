import { formatMessage, messages } from '../../../i18n/index.js';
import type { ConstructionStatus } from './building-materials.js';
import type { SettlerWorkStatus } from './context.js';

/** The status strip's dot and text: green while the house is at something, amber for a stall the player
 *  can act on, grey while it merely stands. */
export type BuildingStatusTone = 'ok' | 'trouble' | 'neutral';

export interface BuildingStatusModel {
  readonly label: string;
  readonly detail: string | null;
  readonly tone: BuildingStatusTone;
}

/** What the strip reads, gathered by the model. */
export interface BuildingStatusInputs {
  /** A site: raised from nothing or a tier up, how far, and its proven stall. */
  readonly site: {
    readonly upgrade: boolean;
    readonly pct: number;
    readonly stall: ConstructionStatus | null;
  } | null;
  /** The alarm is up: how many shelter in the house of how many it takes. */
  readonly alarm: { readonly sheltered: number; readonly capacity: number } | null;
  /** The product of the craft cycle furthest along, null when none runs. */
  readonly crafting: string | null;
  /** The posts filled at a house with worker seats, null for one without. */
  readonly seats: number | null;
  /** The tower posts manned at a house with garrison seats, null for one without. */
  readonly garrison: number | null;
  /** The first posted worker's reading, which names why the house stands. */
  readonly work: SettlerWorkStatus | undefined;
  /** The good that reading names, already labelled. */
  readonly workGood: string | null;
  /** A home's families, null for any other house. */
  readonly families: number | null;
}

/** The first state that holds: the site, the alarm, a home's families, a running craft, a tower's
 *  garrison, missing hands, a stall the posted worker reports, and the house simply at work or standing. */
export function buildingStatus(inputs: BuildingStatusInputs): BuildingStatusModel {
  const copy = messages().hud.buildingPanel.status;
  const { site, alarm, seats, garrison } = inputs;
  if (site !== null) {
    const stall = site.stall === null ? null : copy.stalls[site.stall];
    return {
      label: site.upgrade ? copy.upgrading : copy.building,
      detail: stall === null ? `${site.pct}%` : `${site.pct}% · ${stall}`,
      tone: site.stall === 'missing-materials' || site.stall === 'no-builder' ? 'trouble' : 'ok',
    };
  }
  if (alarm !== null) {
    return { label: copy.alarm, detail: formatMessage(copy.sheltered, alarm), tone: 'trouble' };
  }
  if (inputs.families !== null) {
    return inputs.families > 0
      ? { label: copy.lived, detail: null, tone: 'ok' }
      : { label: copy.empty, detail: null, tone: 'neutral' };
  }
  if (inputs.crafting !== null) return { label: copy.working, detail: inputs.crafting, tone: 'ok' };
  if (garrison !== null) {
    return garrison > 0
      ? { label: copy.manned, detail: null, tone: 'ok' }
      : { label: copy.noGarrison, detail: null, tone: 'trouble' };
  }
  if (seats === 0) return { label: copy.noWorkers, detail: null, tone: 'trouble' };
  const stall = workStall(inputs.work, inputs.workGood);
  if (stall !== null) return { label: copy.idle, detail: stall, tone: 'trouble' };
  if (seats !== null) return { label: copy.working, detail: null, tone: 'ok' };
  return { label: copy.standing, detail: null, tone: 'neutral' };
}

/** The reason a posted worker gives for standing, or null while it works or gives none. */
function workStall(status: SettlerWorkStatus | undefined, good: string | null): string | null {
  const reasons = messages().hud.settlerPanel.idleReasons;
  if (status === undefined) return null;
  switch (status.kind) {
    case 'waitingInput':
      return formatMessage(reasons.waitingInput, { good: good ?? '' });
    case 'outputFull':
    case 'nothingSelected':
    case 'noTool':
      return reasons[status.kind];
    case 'crafting':
    case 'noJob':
    case 'workplaceUnderConstruction':
      return null;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
