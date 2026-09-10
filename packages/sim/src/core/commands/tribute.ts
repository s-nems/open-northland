/** Pay one tribute the seat owes: a slot the map's script opened from `player` that is open, unpaid
 *  and payable. Any other slot is skipped; the handler owns the payment itself. */
export type TributeCommand = {
  readonly kind: 'payTribute';
  /** The paying seat (`[0, MAX_PLAYERS)`), which the authority gate holds to the issuing seat. */
  readonly player: number;
  readonly slot: number;
};
