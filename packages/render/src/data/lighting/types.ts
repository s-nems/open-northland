/** A multiply grade per channel over the whole scene: 1 is daylight, below darkens, above brightens. */
export type LightGrade = readonly [number, number, number];

export const NEUTRAL_GRADE: LightGrade = [1, 1, 1];

/** Rec. 709 luma weights. */
const LUMA: LightGrade = [0.2126, 0.7152, 0.0722];

export function gradeLuminance(grade: LightGrade): number {
  return grade[0] * LUMA[0] + grade[1] * LUMA[1] + grade[2] * LUMA[2];
}
