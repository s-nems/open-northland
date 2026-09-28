/** Whole units as integers, a banked fraction with one decimal. */
export function amountText(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
}

/** A stored amount with the row's limit appended when it has one: a store's capacity, or a construction
 *  line's need. */
export function stockAmount(amount: number, capacity?: number): string {
  return capacity === undefined ? amountText(amount) : `${amountText(amount)} / ${amountText(capacity)}`;
}
