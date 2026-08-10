import { asInteger, asRecord } from '../core/untrusted.js';
import { OLDEST_SUPPORTED_SAVE_VERSION, SAVE_FORMAT_VERSION, SAVE_KIND } from './format.js';

/** A pure transform lifting a whole decoded version-v document to v+1, header stamp included. */
type SaveMigration = (document: Record<string, unknown>) => Record<string, unknown>;

/** Key v holds the v -> v+1 step. A SAVE_FORMAT_VERSION bump lands its migration here in the same
 *  commit or raises OLDEST_SUPPORTED_SAVE_VERSION instead; `registeredMigrations` pins the choice. */
const MIGRATIONS = new Map<number, SaveMigration>();

// v2 added the header's `entry` relaunch token; a v1 save recorded none.
MIGRATIONS.set(1, (document) => ({
  ...document,
  header: { ...asRecord(document.header, 'save.header'), formatVersion: 2, entry: null },
}));

/** The versions the chain can lift, for the test that pins the registry against the format's own
 *  supported range. */
export function registeredMigrations(): readonly number[] {
  return [...MIGRATIONS.keys()].sort((a, b) => a - b);
}

/**
 * Classify an untrusted document's format version and lift it to the current layout. The result is
 * still untrusted data; `parseSaveGame` validates it in full afterwards.
 */
export function migratedToCurrent(value: unknown): Record<string, unknown> {
  const raw = asRecord(value, 'save');
  const header = asRecord(raw.header, 'save.header');
  if (header.kind !== SAVE_KIND) {
    throw new Error(`save.header.kind: expected '${SAVE_KIND}', got ${JSON.stringify(header.kind)}`);
  }
  const version = asInteger(header.formatVersion, 'save.header.formatVersion');
  if (version > SAVE_FORMAT_VERSION) {
    throw new Error(
      `save.header.formatVersion: version ${version} was written by a newer build; this build reads up to ${SAVE_FORMAT_VERSION}`,
    );
  }
  if (version < OLDEST_SUPPORTED_SAVE_VERSION) {
    throw new Error(
      `save.header.formatVersion: version ${version} predates the oldest supported version ${OLDEST_SUPPORTED_SAVE_VERSION}`,
    );
  }
  let document = raw;
  for (let v = version; v < SAVE_FORMAT_VERSION; v++) {
    const step = MIGRATIONS.get(v);
    if (step === undefined) throw new Error(`no migration from save format ${v} is registered`);
    document = step(document);
  }
  return document;
}
