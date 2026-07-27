import type { Brand } from '../core/brand.js';

export type Entity = Brand<number, 'Entity'>;

export interface Component<T> {
  readonly name: string;
  /** Phantom type brand: `T` never exists at runtime (a component value is just `{ name }`), but carrying it
   *  in the type keeps `Component<A>` unassignable where a `Component<B>` is expected. */
  readonly __value?: T;
}

export function defineComponent<T>(name: string): Component<T> {
  return { name };
}
