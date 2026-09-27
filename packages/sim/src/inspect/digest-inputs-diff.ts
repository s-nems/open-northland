import type { SyncDomain } from '../ecs/world.js';
import type { DigestComponentInputs, SyncDigestInputs } from '../simulation/sync-digest.js';

/** The first place two clients' {@link SyncDigestInputs} for one tick part. */
export type DigestInputDifference =
  | { readonly kind: 'rng'; readonly a: number; readonly b: number }
  | { readonly kind: 'entities'; readonly detail: 'nextEntityId' | 'entityCount' | 'allocations' }
  | { readonly kind: 'fog'; readonly index: number }
  | {
      readonly kind: 'component';
      readonly domain: SyncDomain;
      readonly component: string;
      readonly entity: number;
      readonly detail: 'word' | 'onlyInA' | 'onlyInB';
    }
  | { readonly kind: 'componentSet'; readonly detail: 'onlyInA' | 'onlyInB'; readonly component: string };

/**
 * The first difference between two captures of the same tick, or null when they agree. Checks rng, then
 * the entity allocator, then fog words, then which components were touched, then each component's
 * entities in `a`'s component order: `a`'s entities first, then entities only `b` touched.
 */
export function diffDigestInputs(a: SyncDigestInputs, b: SyncDigestInputs): DigestInputDifference | null {
  if (a.tick !== b.tick) throw new Error(`diffDigestInputs compares one tick, got ${a.tick} and ${b.tick}`);
  if (a.rng !== b.rng) return { kind: 'rng', a: a.rng, b: b.rng };
  if (a.nextEntityId !== b.nextEntityId) return { kind: 'entities', detail: 'nextEntityId' };
  if (a.entityCount !== b.entityCount) return { kind: 'entities', detail: 'entityCount' };
  if (firstDifferingIndex(a.allocations, b.allocations) !== null)
    return { kind: 'entities', detail: 'allocations' };
  const fogIndex = firstDifferingIndex(a.fog, b.fog);
  if (fogIndex !== null) return { kind: 'fog', index: fogIndex };

  const bByName = new Map(b.components.map((component) => [component.name, component]));
  const aNames = new Set(a.components.map((component) => component.name));
  for (const component of a.components) {
    if (!bByName.has(component.name)) {
      return { kind: 'componentSet', detail: 'onlyInA', component: component.name };
    }
  }
  for (const component of b.components) {
    if (!aNames.has(component.name)) {
      return { kind: 'componentSet', detail: 'onlyInB', component: component.name };
    }
  }
  for (const component of a.components) {
    const other = bByName.get(component.name);
    if (other === undefined) continue; // unreachable: the set check above returned
    const difference = diffComponent(component, other);
    if (difference !== null) return difference;
  }
  return null;
}

function diffComponent(a: DigestComponentInputs, b: DigestComponentInputs): DigestInputDifference | null {
  const bWords = wordsByEntity(b);
  const aEntities = new Set<number>(a.entities);
  const at = (entity: number, detail: 'word' | 'onlyInA' | 'onlyInB'): DigestInputDifference => ({
    kind: 'component',
    domain: a.domain,
    component: a.name,
    entity,
    detail,
  });
  for (const [i, entity] of a.entities.entries()) {
    const other = bWords.get(entity);
    if (other === undefined) return at(entity, 'onlyInA');
    if (other !== a.words[i]) return at(entity, 'word');
  }
  for (const entity of b.entities) {
    if (!aEntities.has(entity)) return at(entity, 'onlyInB');
  }
  return null;
}

function wordsByEntity(inputs: DigestComponentInputs): Map<number, number> {
  const words = new Map<number, number>();
  for (const [i, entity] of inputs.entities.entries()) {
    const word = inputs.words[i];
    if (word !== undefined) words.set(entity, word);
  }
  return words;
}

/** The first index where the arrays differ, counting a length mismatch at the shorter length. */
function firstDifferingIndex(a: Uint32Array, b: Uint32Array): number | null {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? null : shared;
}

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

export function digestInputsFromJson(json: SyncDigestInputsJson): SyncDigestInputs {
  return {
    tick: json.tick,
    rng: json.rng,
    nextEntityId: json.nextEntityId,
    entityCount: json.entityCount,
    allocations: Uint32Array.from(json.allocations),
    fog: Uint32Array.from(json.fog),
    components: json.components.map((component) => ({
      name: component.name,
      domain: component.domain,
      entities: Uint32Array.from(component.entities),
      words: Uint32Array.from(component.words),
    })),
  };
}
