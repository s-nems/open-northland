/** Opacity `age` ticks into a `life`-tick mark: whole through the `hold` fraction of it, then linear to
 *  0 at its end, and 0 once expired. */
export function heldFadeAlpha(age: number, life: number, hold: number): number {
  if (age <= 0) return 1;
  if (age >= life) return 0;
  const held = life * hold;
  if (age <= held) return 1;
  return 1 - (age - held) / (life - held);
}
