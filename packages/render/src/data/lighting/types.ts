/** A multiply grade per channel over the whole scene: 1 is daylight, below darkens, above brightens. */
export type LightGrade = readonly [number, number, number];

export const NEUTRAL_GRADE: LightGrade = [1, 1, 1];
