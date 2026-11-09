import type { ContentSet } from '@open-northland/data';

/** How a placed landscape object of one `[GfxLandscape]` record grows on the periodic growth trigger. */
export interface LandscapeGrowth {
  /** Valency one growth trigger adds. */
  readonly step: number;
  /** The valency it stops at: the lower of the record's and its logic type's maximum. */
  readonly maxLevel: number;
}

// `landscapetypes.ini` `transition` tuple fields: the event, the type it turns into, how the valency
// changes (`SIZE_CHANGE_ADD` adds the amount) and by how much.
const TRANSITION_EVENT = 0;
const TRANSITION_NEXT_TYPE = 1;
const TRANSITION_SIZE_CHANGE = 2;
const TRANSITION_SIZE_AMOUNT = 3;
/** The periodic growth trigger, `transition 7` (a tree's `transition 7 4 2 1 0`). */
const GROWTH_EVENT = 7;
const SIZE_CHANGE_ADD = 2;

/**
 * Per `[GfxLandscape]` record index, the growth of an object whose logic type grows in place: a growth
 * transition back into its own type that adds valency. A record whose type has none is absent.
 */
export function landscapeGrowthByGfx(content: ContentSet): ReadonlyMap<number, LandscapeGrowth> {
  const steps = new Map<number, { step: number; maxValency: number }>();
  for (const type of content.landscape) {
    const growth = type.transitions.find(
      (t) =>
        t[TRANSITION_EVENT] === GROWTH_EVENT &&
        t[TRANSITION_NEXT_TYPE] === type.typeId &&
        t[TRANSITION_SIZE_CHANGE] === SIZE_CHANGE_ADD,
    );
    const step = growth?.[TRANSITION_SIZE_AMOUNT] ?? 0;
    if (step > 0) steps.set(type.typeId, { step, maxValency: type.maxValency });
  }
  const out = new Map<number, LandscapeGrowth>();
  for (const record of content.landscapeGfx) {
    const type = steps.get(record.logicType);
    if (type === undefined) continue;
    const maxLevel = Math.min(record.maxValency ?? type.maxValency, type.maxValency);
    out.set(record.index, { step: type.step, maxLevel });
  }
  return out;
}
