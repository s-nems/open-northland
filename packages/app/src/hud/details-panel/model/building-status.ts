import { formatMessage, messages } from '../../../i18n/index.js';
import type { ConstructionStatus } from './building-materials.js';

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
  /** A posted operator's reason for waiting, already localized. */
  readonly workDetail: string | null;
  /** A home's families, null for any other house. */
  readonly families: number | null;
  /** A finished temple's blessing, null for any other house and another seat's temple. */
  readonly blessing: TempleBlessing | null;
}

/** Whether a temple blesses, with the game seconds its stored oil still burns (null for a temple that
 *  needs none), or what keeps it from blessing. */
export type TempleBlessing =
  | { readonly state: 'on'; readonly secondsLeft: number | null }
  | { readonly state: 'no-oil' | 'damaged' | 'doused' };

const SECONDS_PER_MINUTE = 60;

type StatusCopy = ReturnType<typeof messages>['hud']['buildingPanel']['status'];

/** What a temple that does not bless says, by what keeps it from blessing. */
const BLESSING_OFF_LABEL: Readonly<
  Record<Exclude<TempleBlessing['state'], 'on'>, (copy: StatusCopy) => string>
> = {
  'no-oil': (copy) => copy.noOil,
  damaged: (copy) => copy.blessingDamaged,
  doused: (copy) => copy.blessingDoused,
};

/** The first state that holds: the site, the alarm, a temple's blessing, a home's families, a running
 *  craft, a tower's garrison, missing hands, a stall the posted worker reports, and the house simply
 *  standing. A temple's porter is optional, so its empty post is no trouble. */
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
  const blessing = inputs.blessing;
  if (blessing !== null) {
    if (blessing.state !== 'on') {
      return {
        label: BLESSING_OFF_LABEL[blessing.state](copy),
        detail: null,
        tone: 'trouble',
      };
    }
    // None left to count on a scripted seat's temple, which blesses on an empty store.
    const left = blessing.secondsLeft;
    const minutes = left === null || left <= 0 ? null : Math.ceil(left / SECONDS_PER_MINUTE);
    return {
      label: copy.blessing,
      detail: minutes === null ? null : formatMessage(copy.oilLeft, { minutes }),
      tone: 'ok',
    };
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
  const stall = inputs.workDetail;
  if (stall !== null) return { label: copy.idle, detail: stall, tone: 'trouble' };
  return { label: copy.standing, detail: null, tone: 'neutral' };
}
