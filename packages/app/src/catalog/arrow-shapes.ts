import type { ShotShape } from '@open-northland/render';

/**
 * How a bow's arrow draws in flight, as multiples of the one authored arrow sprite, so a long bow's shot
 * reads apart from a short bow's at a glance. Open Northland's presentation: the original draws every
 * arrow alike. Keyed by `ir.json` weapon id-slug.
 */
const LONG_ARROW: ShotShape = { length: 1.3, thickness: 1.25 };
const SHORT_ARROW: ShotShape = { length: 0.8, thickness: 1 };

const ARROW_SHAPE_BY_ID: Readonly<Record<string, ShotShape>> = {
  long_bow: LONG_ARROW,
  hero_bow: LONG_ARROW,
};

/** The arrow every other shooter looses, a hunter or a building firing from its walls among them. */
export const DEFAULT_ARROW_SHAPE = SHORT_ARROW;

/** The arrow of a weapon id that draws one of its own. */
export function arrowShapeById(id: string): ShotShape | undefined {
  return ARROW_SHAPE_BY_ID[id];
}
