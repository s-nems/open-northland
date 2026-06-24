/**
 * Zero-runtime nominal typing. `Brand<number, 'Foo'>` is assignable TO `number` (you can read it as
 * one) but a raw `number` is NOT assignable to it — so distinct semantic ints (Fixed, Entity,
 * GoodId, AtomicId, ...) stop being silently interchangeable. The original game's "everything is a
 * magic number" is exactly the fragility we're avoiding; brands enforce the distinction at compile
 * time with no cost at runtime.
 */
declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Compile-time exhaustiveness guard for discriminated-union switches. */
export function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}
