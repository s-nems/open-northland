import { asCount, asInteger, asRecord, typeName } from '../core/untrusted.js';
import { SYNC_DOMAINS, type SyncDomain } from '../ecs/sync-domain.js';
import type { DigestComponentInputs, SyncDigestInputs } from '../simulation/sync-digest.js';

export interface DigestComponentInputsJson {
  readonly name: string;
  readonly domain: SyncDomain;
  readonly entities: readonly number[];
  readonly words: readonly number[];
}

/** {@link SyncDigestInputs} with plain number arrays, since typed arrays do not survive JSON. */
export interface SyncDigestInputsJson {
  readonly tick: number;
  readonly rng: number;
  readonly nextEntityId: number;
  readonly entityCount: number;
  readonly allocations: readonly number[];
  readonly fog: readonly number[];
  readonly components: readonly DigestComponentInputsJson[];
}

export function digestInputsToJson(inputs: SyncDigestInputs): SyncDigestInputsJson {
  return {
    tick: inputs.tick,
    rng: inputs.rng,
    nextEntityId: inputs.nextEntityId,
    entityCount: inputs.entityCount,
    allocations: Array.from(inputs.allocations),
    fog: Array.from(inputs.fog),
    components: inputs.components.map((component) => ({
      name: component.name,
      domain: component.domain,
      entities: Array.from(component.entities),
      words: Array.from(component.words),
    })),
  };
}

/** Validate external JSON before typed arrays can truncate or coerce its words. */
export function digestInputsFromJson(value: unknown): SyncDigestInputs {
  const at = 'inputs';
  const raw = asRecord(value, at);
  const rng = asInteger(raw.rng, `${at}.rng`);
  // Seeds are unsigned; after the first draw, the stream state may be signed.
  if (rng < -(2 ** 31) || rng >= 2 ** 32) {
    throw new Error(`${at}.rng: ${rng} is outside the 32-bit stream domain`);
  }
  const names = new Set<string>();
  const components = asArray(raw.components, `${at}.components`).map((component, i) =>
    parsedComponent(component, `${at}.components[${i}]`, names),
  );
  return {
    tick: safeCount(raw.tick, `${at}.tick`),
    rng,
    nextEntityId: safeCount(raw.nextEntityId, `${at}.nextEntityId`),
    entityCount: safeCount(raw.entityCount, `${at}.entityCount`),
    allocations: wordsFromJson(raw.allocations, `${at}.allocations`),
    fog: wordsFromJson(raw.fog, `${at}.fog`),
    components,
  };
}

function parsedComponent(value: unknown, at: string, names: Set<string>): DigestComponentInputs {
  const raw = asRecord(value, at);
  const name = raw.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${at}.name: expected a non-empty component name`);
  }
  if (names.has(name)) throw new Error(`${at}.name: duplicate component '${name}'`);
  names.add(name);
  const domain = SYNC_DOMAINS.find((domain) => domain === raw.domain);
  if (domain === undefined)
    throw new Error(`${at}.domain: unknown sync domain ${JSON.stringify(raw.domain)}`);
  const entities = wordsFromJson(raw.entities, `${at}.entities`);
  const words = wordsFromJson(raw.words, `${at}.words`);
  if (entities.length !== words.length) {
    throw new Error(`${at}.words: expected one word per entity`);
  }
  if (new Set(entities).size !== entities.length) {
    throw new Error(`${at}.entities: duplicate entity`);
  }
  return { name, domain, entities, words };
}

function wordsFromJson(value: unknown, at: string): Uint32Array {
  const raw = asArray(value, at);
  return Uint32Array.from(raw, (word, i) => {
    const n = asCount(word, `${at}[${i}]`);
    if (n > 0xffffffff) throw new Error(`${at}[${i}]: ${n} is outside the unsigned 32-bit word domain`);
    return n;
  });
}

function asArray(value: unknown, at: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at}: expected an array, got ${typeName(value)}`);
  return value;
}

function safeCount(value: unknown, at: string): number {
  const n = asCount(value, at);
  if (!Number.isSafeInteger(n)) throw new Error(`${at}: expected a safe integer, got ${n}`);
  return n;
}
