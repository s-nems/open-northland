import { isFogMode } from '../components/rules.js';
import { parseCommandEnvelope } from '../core/commands/parse.js';
import { parseContinuation } from '../core/continuation.js';
import { asCount, asInteger, asRecord, typeName } from '../core/untrusted.js';
import {
  type CommandsSection,
  type ComponentSection,
  type EntitiesSection,
  type FogSection,
  type RngSection,
  SAVE_FORMAT_VERSION,
  SAVE_KIND,
  type SaveGame,
  type SaveGameHeader,
  type SaveGameSection,
} from './format.js';
import { parseContentFingerprint, parseSavedAt } from './header-fields.js';
import { copySessionMetadata } from './session-metadata.js';

export const MAX_SUBMISSION_DEPTH = 16;

/**
 * Validate a save decoded from untrusted JSON into a structurally sound {@link SaveGame}: header
 * identity, the exact section order, allocation coherence, and every pending envelope. Component
 * entry values stay opaque here; `restoreSimulation` validates them as it materializes, along with
 * everything that needs loaded content or a map.
 */
export function parseSaveGame(value: unknown): SaveGame {
  return parseWorld(value, 0);
}

function parseWorld(value: unknown, depth: number): SaveGame {
  if (depth > MAX_SUBMISSION_DEPTH) throw new Error('save.parent: sub-mission nesting limit exceeded');
  const raw = asRecord(value, 'save');
  const header = parsedHeader(raw.header);
  return {
    header,
    sections: parsedSections(raw.sections, header),
    ...(raw.parent !== undefined ? { parent: parseWorld(raw.parent, depth + 1) } : {}),
  };
}

function parsedHeader(value: unknown): SaveGameHeader {
  const at = 'save.header';
  const raw = asRecord(value, at);
  if (raw.kind !== SAVE_KIND) {
    throw new Error(`${at}.kind: expected '${SAVE_KIND}', got ${JSON.stringify(raw.kind)}`);
  }
  if (raw.formatVersion !== SAVE_FORMAT_VERSION) {
    throw new Error(
      `${at}.formatVersion: unsupported version ${JSON.stringify(raw.formatVersion)}, this build reads ${SAVE_FORMAT_VERSION}`,
    );
  }
  return {
    kind: SAVE_KIND,
    formatVersion: SAVE_FORMAT_VERSION,
    irVersion: asCount(raw.irVersion, `${at}.irVersion`),
    contentRevision: asCount(raw.contentRevision, `${at}.contentRevision`),
    contentFingerprint: parseContentFingerprint(raw.contentFingerprint),
    savedAt: parseSavedAt(raw.savedAt),
    mapId: asNullableString(raw.mapId, `${at}.mapId`),
    mapFingerprint: asNullableString(raw.mapFingerprint, `${at}.mapFingerprint`),
    entry: asNullableString(raw.entry, `${at}.entry`),
    session: copySessionMetadata(raw.session),
    seed: asInteger(raw.seed, `${at}.seed`),
    tick: asCount(raw.tick, `${at}.tick`),
  };
}

/** Sections must appear in the one canonical order - `entities`, the component stores, `rng`, `fog`
 *  (exactly when the header names a map), `commands` - which also rejects every duplicated or
 *  unknown section. */
function parsedSections(value: unknown, header: SaveGameHeader): readonly SaveGameSection[] {
  if (!Array.isArray(value)) {
    throw new Error(`save.sections: expected an array, got ${typeName(value)}`);
  }
  const raws = value.map((section: unknown, i) => asRecord(section, `save.sections[${i}]`));
  const take = (i: number, wanted: string): Record<string, unknown> => {
    const raw = raws[i];
    if (raw === undefined || raw.id !== wanted) {
      throw new Error(
        `save.sections[${i}]: expected the '${wanted}' section, got ${JSON.stringify(raw?.id)}`,
      );
    }
    return raw;
  };

  const entities = parsedEntities(take(0, 'entities'), 'save.sections[0]');
  const sections: SaveGameSection[] = [entities];
  const alive = new Set(entities.alive);
  const componentNames = new Set<string>();
  let i = 1;
  for (; i < raws.length && raws[i]?.id === 'component'; i++) {
    sections.push(parsedComponent(take(i, 'component'), `save.sections[${i}]`, alive, componentNames));
  }
  sections.push(parsedRng(take(i, 'rng'), `save.sections[${i}]`));
  i++;
  if (header.mapFingerprint !== null) {
    sections.push(parsedFog(take(i, 'fog'), `save.sections[${i}]`));
    i++;
  } else if (raws[i]?.id === 'fog') {
    throw new Error(`save.sections[${i}]: a mapless save cannot carry a fog section`);
  }
  sections.push(parsedCommands(take(i, 'commands'), `save.sections[${i}]`, header.tick));
  i++;
  if (i < raws.length) {
    throw new Error(
      `save.sections[${i}]: unexpected section after 'commands', got ${JSON.stringify(raws[i]?.id)}`,
    );
  }
  return sections;
}

/** Allocation ceiling for a restored world. Ids are never recycled, so the counter must stay far
 *  inside the range where `id + 1` is still a distinct integer: past 2^53 it stops advancing and
 *  every later `create` hands out an id that is already in use. */
const MAX_ENTITY_ID = 0x7fffffff;

function parsedEntities(raw: Record<string, unknown>, at: string): EntitiesSection {
  const nextId = asCount(raw.nextId, `${at}.nextId`);
  if (nextId < 1) throw new Error(`${at}.nextId: entity ids start at 1, got ${nextId}`);
  if (nextId > MAX_ENTITY_ID) {
    throw new Error(`${at}.nextId: ${nextId} is past the ${MAX_ENTITY_ID} allocation ceiling`);
  }
  const rawAlive = raw.alive;
  if (!Array.isArray(rawAlive)) {
    throw new Error(`${at}.alive: expected an array, got ${typeName(rawAlive)}`);
  }
  const alive: number[] = [];
  let previous = 0;
  rawAlive.forEach((id: unknown, j) => {
    const n = asCount(id, `${at}.alive[${j}]`);
    if (n <= previous) throw new Error(`${at}.alive[${j}]: ${n} does not ascend past ${previous}`);
    if (n >= nextId) throw new Error(`${at}.alive[${j}]: ${n} was never allocated (nextId ${nextId})`);
    alive.push(n);
    previous = n;
  });
  return { id: 'entities', nextId, alive };
}

function parsedComponent(
  raw: Record<string, unknown>,
  at: string,
  alive: ReadonlySet<number>,
  seenNames: Set<string>,
): ComponentSection {
  const name = raw.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${at}.name: expected a component name, got ${JSON.stringify(name)}`);
  }
  if (seenNames.has(name)) throw new Error(`${at}.name: duplicate component section '${name}'`);
  seenNames.add(name);
  const rawEntries = raw.entries;
  if (!Array.isArray(rawEntries)) {
    throw new Error(`${at}.entries: expected an array, got ${typeName(rawEntries)}`);
  }
  const entered = new Set<number>();
  const entries = rawEntries.map((entry: unknown, j) => {
    const atEntry = `${at}.entries[${j}]`;
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${atEntry}: expected an [entity, value] pair`);
    }
    const entity = asCount(entry[0], `${atEntry}[0]`);
    if (!alive.has(entity)) throw new Error(`${atEntry}: entity ${entity} is not alive`);
    if (entered.has(entity)) throw new Error(`${atEntry}: duplicate entry for entity ${entity}`);
    entered.add(entity);
    return [entity, entry[1] as unknown] as const;
  });
  return { id: 'component', name, entries };
}

/** The domain `Rng.getState` can report: the unsigned seed domain before the first draw, the signed
 *  `| 0` domain after it. */
const RNG_STATE_MIN = -(2 ** 31);
const RNG_STATE_MAX_EXCLUSIVE = 2 ** 32;

function parsedRng(raw: Record<string, unknown>, at: string): RngSection {
  const state = asInteger(raw.state, `${at}.state`);
  if (state < RNG_STATE_MIN || state >= RNG_STATE_MAX_EXCLUSIVE) {
    throw new Error(`${at}.state: ${state} is outside the 32-bit stream domain`);
  }
  return { id: 'rng', state };
}

function parsedFog(raw: Record<string, unknown>, at: string): FogSection {
  const activeMode = asInteger(raw.activeMode, `${at}.activeMode`);
  if (!isFogMode(activeMode)) throw new Error(`${at}.activeMode: unknown fog mode ${activeMode}`);
  const lastRebuildTick = asInteger(raw.lastRebuildTick, `${at}.lastRebuildTick`);
  if (lastRebuildTick < -1) {
    throw new Error(`${at}.lastRebuildTick: expected -1 (never rebuilt) or a tick, got ${lastRebuildTick}`);
  }
  const rawMasks = raw.masks;
  if (!Array.isArray(rawMasks)) {
    throw new Error(`${at}.masks: expected an array, got ${typeName(rawMasks)}`);
  }
  let previousPlayer = -1;
  const masks = rawMasks.map((entry: unknown, j) => {
    const atMask = `${at}.masks[${j}]`;
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`${atMask}: expected a [player, mask] pair`);
    }
    const player = asCount(entry[0], `${atMask}[0]`);
    if (player <= previousPlayer) {
      throw new Error(`${atMask}[0]: player ${player} does not ascend past ${previousPlayer}`);
    }
    previousPlayer = player;
    const digits = entry[1];
    if (typeof digits !== 'string' || !/^[0-2]+$/.test(digits)) {
      throw new Error(`${atMask}[1]: a mask is a non-empty string of FOG_STATE digits`);
    }
    return [player, digits] as const;
  });
  return { id: 'fog', activeMode, lastRebuildTick, masks };
}

function parsedCommands(raw: Record<string, unknown>, at: string, tick: number): CommandsSection {
  const rawPending = raw.pending;
  if (!Array.isArray(rawPending)) {
    throw new Error(`${at}.pending: expected an array, got ${typeName(rawPending)}`);
  }
  return {
    id: 'commands',
    continuation: parseContinuation(raw.continuation, tick, `${at}.continuation`),
    nextSequence: asCount(raw.nextSequence, `${at}.nextSequence`),
    pending: rawPending.map((entry: unknown, j) => parseCommandEnvelope(entry, `${at}.pending[${j}]`)),
  };
}

function asNullableString(value: unknown, at: string): string | null {
  if (value === null || typeof value === 'string') return value;
  throw new Error(`${at}: expected a string or null, got ${typeName(value)}`);
}
