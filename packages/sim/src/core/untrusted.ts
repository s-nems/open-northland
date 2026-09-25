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

/** The last C0 control code point. With DEL through the last C1 control, the codes a name may not carry. */
const C0_CONTROL_LAST = 0x1f;
const DELETE_CODE_POINT = 0x7f;
const C1_CONTROL_LAST = 0x9f;

/** Whether `text` carries a control character: a C0 control, DEL or a C1 control. */
export function hasControlCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    if (code <= C0_CONTROL_LAST || (code >= DELETE_CODE_POINT && code <= C1_CONTROL_LAST)) return true;
  }
  return false;
}

/** The length of `text` in Unicode code points, the unit a text limit counts. */
export function codePointLength(text: string): number {
  let length = 0;
  for (const _ of text) length++;
  return length;
}
