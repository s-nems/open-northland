/**
 * A Fisher-Yates order over `items` that leads with `first` while the pool still has it, so a
 * rotation can open on what is already showing. `random` is injected so tests can pin the order.
 */
export function rotationOrder(
  items: readonly string[],
  first: string | null,
  random: () => number,
): readonly string[] {
  const order = [...items];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = order[i];
    const b = order[j];
    if (a !== undefined && b !== undefined) {
      order[i] = b;
      order[j] = a;
    }
  }
  const at = first === null ? -1 : order.indexOf(first);
  return at > 0 ? [...order.slice(at), ...order.slice(0, at)] : order;
}
