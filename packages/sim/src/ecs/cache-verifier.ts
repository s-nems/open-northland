import type { Component, Entity } from './component.js';

/** Re-derives one incrementally-maintained cache from authoritative state and returns a message per
 *  mismatch (empty = coherent). Must be pure over current state. */
export type CacheVerifier = () => string[];

/** The World state a re-derive reads: `alive` and `stores` are authoritative, while `memberships` and
 *  `canonicalCache` are the derived views that must reproduce from them. */
export interface VerifiableStorage {
  readonly alive: ReadonlySet<Entity>;
  readonly stores: ReadonlyMap<Component<unknown>, ReadonlyMap<Entity, unknown>>;
  readonly registered: readonly Component<unknown>[];
  readonly memberships: ReadonlyMap<Entity, readonly number[]>;
  readonly canonicalCache: readonly Entity[] | null;
}

export class CacheVerifiers {
  /** Registering a name again replaces the verifier but keeps its position. */
  private readonly byName = new Map<string, CacheVerifier>();

  register(name: string, verifier: CacheVerifier): void {
    this.byName.set(name, verifier);
  }

  /** Reports in a fixed order - canonical memo, memberships, then registered verifiers - which callers
   *  assert against. The World's own two checks are not registrations, so no name can shadow them. */
  run(storage: VerifiableStorage): string[] {
    const out = verifyCanonicalCache(storage);
    out.push(...verifyMemberships(storage));
    for (const verify of this.byName.values()) out.push(...verify());
    return out;
  }
}

/** Re-derive the per-entity membership lists from the stores: every store entry must be listed, every
 *  listed index must be stored, and lists must ascend (registration order). */
function verifyMemberships({ registered, stores, memberships }: VerifiableStorage): string[] {
  const out: string[] = [];
  registered.forEach((component, index) => {
    const store = stores.get(component);
    if (store === undefined) return;
    for (const e of store.keys()) {
      if (memberships.get(e)?.includes(index) !== true) {
        out.push(`entity ${e} carries ${component.name} but its membership list misses it`);
      }
    }
  });
  for (const [e, list] of memberships) {
    let previous = -1;
    for (const index of list) {
      const component = registered[index];
      if (component === undefined || stores.get(component)?.has(e) !== true) {
        out.push(`entity ${e} lists component index ${index} it does not carry`);
      }
      if (index <= previous) out.push(`entity ${e} membership list is not ascending at index ${index}`);
      previous = index;
    }
  }
  return out;
}

function verifyCanonicalCache({ canonicalCache, alive }: VerifiableStorage): string[] {
  if (canonicalCache === null) return [];
  const out: string[] = [];
  const fresh = [...alive].sort((a, b) => a - b);
  if (canonicalCache.length !== fresh.length) {
    out.push(
      `canonicalEntities cache holds ${canonicalCache.length} ids but ${fresh.length} are alive - a create/destroy missed invalidation`,
    );
    return out;
  }
  for (let i = 0; i < fresh.length; i++) {
    if (canonicalCache[i] !== fresh[i]) {
      out.push(
        `canonicalEntities cache diverges at index ${i}: cached ${canonicalCache[i]}, alive ${fresh[i]} - stale memo`,
      );
      break;
    }
  }
  return out;
}
