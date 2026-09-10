/** How much of an untrusted value a refusal quotes back. */
const PREVIEW_LENGTH = 40;

export function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at}: expected an object, got ${typeName(value)}`);
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at}: expected an array, got ${typeName(value)}`);
  return value;
}

/** A short quote of an untrusted value for a refusal, so the refusal itself stays within its cap. */
export function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? typeName(value);
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}...` : text;
}

export function asInteger(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${at}: expected an integer, got ${preview(value)}`);
  }
  return value;
}

export function asCount(value: unknown, at: string): number {
  const n = asInteger(value, at);
  if (n < 0) throw new Error(`${at}: expected a non-negative integer, got ${n}`);
  return n;
}

export function asBoolean(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${at}: expected a boolean, got ${typeName(value)}`);
  return value;
}

export function asString(value: unknown, at: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${at}: expected a string, got ${typeName(value)}`);
  if (value.length > maxLength) throw new Error(`${at}: longer than ${maxLength} characters`);
  return value;
}

export function asPositiveNumber(value: unknown, at: string, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new Error(`${at}: expected a number in (0, ${max}], got ${preview(value)}`);
  }
  return value;
}

export function asOneOf<T extends string>(value: unknown, options: readonly T[], at: string): T {
  const found = options.find((option) => option === value);
  if (found === undefined) {
    throw new Error(`${at}: expected one of ${options.join(', ')}, got ${preview(value)}`);
  }
  return found;
}
