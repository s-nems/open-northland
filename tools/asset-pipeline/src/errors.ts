/**
 * A throw site is not obliged to throw an `Error`: casting instead of narrowing renders a thrown
 * string or host exception as the literal text `undefined`, hiding the cause of a skipped input.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
