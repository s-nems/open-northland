/**
 * A stored amount to one decimal, with the row's limit appended when it has one: a store's capacity, or
 * a construction line's need (observed off the original's 1024×768 screenshots).
 */
export function stockAmount(amount: number, capacity?: number): string {
  return capacity === undefined ? amount.toFixed(1) : `${amount.toFixed(1)} / ${capacity.toFixed(1)}`;
}
