/** Whether `count` matches satisfy a goal asking for `amount`. The original compares inside its match
 *  loop, so an amount of 0 still needs one match (reading). */
export function countReaches(count: number, amount: number): boolean {
  return count >= Math.max(amount, 1);
}

/** The matches a goal must find before {@link countReaches} can hold: an early exit's limit. */
export function neededMatches(amount: number): number {
  return Math.max(amount, 1);
}
