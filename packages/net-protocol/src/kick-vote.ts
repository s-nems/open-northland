/** The yeses a kick vote needs to pass: a strict majority of `others`, the connected members other
 *  than its target. With nobody else connected it needs one yes nobody can cast. */
export function kickVotesNeeded(others: number): number {
  return Math.floor(others / 2) + 1;
}
