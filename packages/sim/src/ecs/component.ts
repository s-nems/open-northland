import type { Brand } from '../core/brand.js';

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
  /** Phantom type brand: `T` never exists at runtime (a component value is just `{ name }`), but carrying it
   *  in the type keeps `Component<A>` unassignable where a `Component<B>` is expected. */
  readonly __value?: T;
}

export function defineComponent<T>(name: string): Component<T> {
  return { name };
}
