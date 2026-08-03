/**
 * Zero-runtime nominal typing. `Brand<number, 'Foo'>` is assignable to `number`, but a raw `number` is
 * not assignable to it, so distinct semantic ints (Fixed, Entity, GoodId, AtomicId) stop being silently
 * interchangeable.
 */
declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Compile-time exhaustiveness guard for discriminated-union switches. */
export function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}
