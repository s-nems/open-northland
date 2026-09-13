/** The message of a thrown value as a person reads it, without the `Error:` prefix `String` adds. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
