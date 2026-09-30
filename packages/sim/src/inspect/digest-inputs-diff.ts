import type { SyncDomain } from '../ecs/world.js';
import type { DigestComponentInputs, SyncDigestInputs } from '../simulation/sync-digest.js';

/** The first place two clients' {@link SyncDigestInputs} for one tick part. An `order` detail means both
 *  sides touched the same set in a different first-touch order, which the digest folds as a difference. */
export type DigestInputDifference =
  | { readonly kind: 'rng'; readonly a: number; readonly b: number }
  | { readonly kind: 'entities'; readonly detail: 'nextEntityId' | 'entityCount' | 'allocations' }
  | { readonly kind: 'fog'; readonly index: number }
  | {
      readonly kind: 'component';
      readonly domain: SyncDomain;
      readonly component: string;
      /** For `order`, `a`'s entity at the first place the two entity orders part. */
      readonly entity: number;
      readonly detail: 'word' | 'onlyInA' | 'onlyInB' | 'order';
    }
  | { readonly kind: 'componentSet'; readonly detail: 'onlyInA' | 'onlyInB'; readonly component: string }
  | {
      readonly kind: 'componentSet';
      readonly detail: 'order';
      readonly domain: SyncDomain;
      /** `a`'s component at the first place the domain's two component orders part. */
      readonly component: string;
    };

/**
 * The first difference between two captures of the same tick, or null when they agree. Checks rng, then
 * the entity allocator, then fog words, then which components were touched and their order within each
 * domain, then each component in `a`'s order: which entities it touched, their order, their words.
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
  const orderDifference = diffComponentOrder(a.components, b.components);
  if (orderDifference !== null) return orderDifference;
  for (const component of a.components) {
    const other = bByName.get(component.name);
    if (other === undefined) continue; // unreachable: the set check above returned
    const difference = diffComponent(component, other);
    if (difference !== null) return difference;
  }
  return null;
}

/** Each domain folds its components in turn, so only the order within one domain reaches the digest. */
function diffComponentOrder(
  a: readonly DigestComponentInputs[],
  b: readonly DigestComponentInputs[],
): DigestInputDifference | null {
  const bByDomain = namesByDomain(b);
  for (const [domain, aNames] of namesByDomain(a)) {
    const bNames = bByDomain.get(domain);
    for (const [i, name] of aNames.entries()) {
      if (bNames?.[i] !== name) return { kind: 'componentSet', detail: 'order', domain, component: name };
    }
  }
  return null;
}

function namesByDomain(components: readonly DigestComponentInputs[]): Map<SyncDomain, string[]> {
  const names = new Map<SyncDomain, string[]>();
  for (const component of components) {
    const list = names.get(component.domain);
    if (list === undefined) names.set(component.domain, [component.name]);
    else list.push(component.name);
  }
  return names;
}

function diffComponent(a: DigestComponentInputs, b: DigestComponentInputs): DigestInputDifference | null {
  const aEntities = new Set<number>(a.entities);
  const bEntities = new Set<number>(b.entities);
  const at = (entity: number, detail: 'word' | 'onlyInA' | 'onlyInB' | 'order'): DigestInputDifference => ({
    kind: 'component',
    domain: a.domain,
    component: a.name,
    entity,
    detail,
  });
  for (const entity of a.entities) {
    if (!bEntities.has(entity)) return at(entity, 'onlyInA');
  }
  for (const entity of b.entities) {
    if (!aEntities.has(entity)) return at(entity, 'onlyInB');
  }
  for (const [i, entity] of a.entities.entries()) {
    if (b.entities[i] !== entity) return at(entity, 'order');
  }
  for (const [i, entity] of a.entities.entries()) {
    if (b.words[i] !== a.words[i]) return at(entity, 'word');
  }
  return null;
}

/** The first index where the arrays differ, counting a length mismatch at the shorter length. */
function firstDifferingIndex(a: Uint32Array, b: Uint32Array): number | null {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? null : shared;
}
