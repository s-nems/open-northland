const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

export function parseSavedAt(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP_MS) {
    throw new Error('save.header.savedAt: expected Unix milliseconds in the supported date range or null');
  }
  return value;
}

export function parseContentFingerprint(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('save.header.contentFingerprint: expected a lowercase SHA-256 digest or null');
  }
  return value;
}
