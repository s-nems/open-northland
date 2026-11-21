/**
 * How long a bow's arrow draws in flight, as a multiple of the one authored arrow sprite, so a long bow's
 * shot reads apart from a short bow's at a glance. Open Northland's presentation: the original draws every
 * arrow alike. Keyed by `ir.json` weapon id-slug.
 */
const LONG_ARROW = 1.3;
const SHORT_ARROW = 0.8;

const ARROW_LENGTH_BY_ID: Readonly<Record<string, number>> = {
  long_bow: LONG_ARROW,
  hero_bow: LONG_ARROW,
};

/** The arrow every other shooter looses, a hunter or a building firing from its walls among them. */
export const DEFAULT_ARROW_LENGTH = SHORT_ARROW;

/** The arrow of a weapon id that draws one of its own. */
export function arrowLengthById(id: string): number | undefined {
  return ARROW_LENGTH_BY_ID[id];
}
