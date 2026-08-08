/** Shape assertions for values decoded from untrusted JSON; each throws naming the `at` path. */

export function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at}: expected an object, got ${typeName(value)}`);
  }
  return value as Record<string, unknown>;
}

export function asInteger(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${at}: expected an integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function asCount(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${at}: expected a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function typeName(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'an array' : typeof value;
}
