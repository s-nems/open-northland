/** Give the match up: the seat is defeated as a seat whose people died out is (`systems/match`).
 *  `player` is the surrendering seat, which the authority gate holds to the issuing seat. */
export type MatchCommand = {
  readonly kind: 'surrender';
  readonly player: number;
};
