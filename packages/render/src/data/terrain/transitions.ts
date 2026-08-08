import { TRANSITION_NONE, TRANSITION_PAIRS } from '@open-northland/data';

export { TRANSITION_NONE };

/** Decode one value of the map's `emt1..emt4` transition-overlay lanes, one packed u8 per triangle. */
export function transitionRef(v: number): { readonly transition: number; readonly pair: number } | undefined {
  if (v === TRANSITION_NONE) return undefined;
  return { transition: Math.floor(v / TRANSITION_PAIRS), pair: v % TRANSITION_PAIRS };
}
