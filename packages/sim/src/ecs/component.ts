import type { Brand } from '../core/brand.js';
import type { SyncDomain } from './sync-domain.js';

export type Entity = Brand<number, 'Entity'>;

/**
 * The read-only view of a component value that `World.get`/`World.tryGet` return: mutating stored state
 * through a plain read would bypass the touched log and value generations every derived cache invalidates
 * from, so writes must acquire the value through `World.mut`/`World.tryMut` instead.
 */
export type DeepReadonly<T> = T extends null | undefined | string | number | boolean | bigint | symbol
  ? T
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends Set<infer E>
      ? ReadonlySet<DeepReadonly<E>>
      : T extends readonly (infer E)[]
        ? readonly DeepReadonly<E>[]
        : { readonly [K in keyof T]: DeepReadonly<T[K]> };

export interface Component<T> {
  readonly name: string;
  /** The sync-digest group this component's writes fold into (see {@link SyncDomain}). */
  readonly domain: SyncDomain;
  /** Phantom type brand: `T` never exists at runtime (a component is just `{ name, domain }`), but carrying it
   *  in the type keeps `Component<A>` unassignable where a `Component<B>` is expected. */
  readonly __value?: T;
}

/** Every defined component by name: the vocabulary a save's component sections resolve against. */
const defined = new Map<string, Component<unknown>>();

/** `name` must be unique per process - it is the component's identity in state hashes and save files,
 *  where two stores sharing a name would be indistinguishable. `domain` groups the component's writes
 *  in a sync digest. */
export function defineComponent<T>(name: string, domain: SyncDomain): Component<T> {
  if (defined.has(name)) throw new Error(`component name '${name}' is already defined`);
  const component: Component<T> = { name, domain };
  defined.set(name, component);
  return component;
}

export function componentByName(name: string): Component<unknown> | undefined {
  return defined.get(name);
}
