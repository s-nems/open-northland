# Compile the fixed-point overflow asserts out of the shipped build

**Area:** sim, app · **Focus:** core/fixed, nav/world-metric · **Priority:** P3

`core/fixed.ts` decides its dev-only overflow asserts at load time:
`globalThis.process?.env?.NODE_ENV !== 'production'`. A browser page and the sim worker have no
`process`, and `packages/app/vite.config.ts` defines no `NODE_ENV` (Vite replaces only the literal
`process.env.NODE_ENV`, not this read through a cast `globalThis`), so the asserts very likely run in
the web and desktop builds, while the comment says they are statically eliminated. Every `fx` add,
multiply and wrap then pays `Number.isSafeInteger` or an absolute-value check.

Measured in the headless bench, where the asserts are also on (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`,
t100k profile): `assertSafe` 0.84% self; `staggerShift` (`nav/world-metric.ts`) 2.1% self and
`worldX` 3.2% inclusive, through `wrap`, `div` and the asserts, called from `entityNode`,
`nodeHxOfPosition`, movement's `worldDistance` and `NodeBuckets.refill`.

## Scope

- Verify first in the built worker bundle (`npm run build`) whether the assert branch survives and what
  `DEV` evaluates to at runtime.
- The asserts run in tests, benches and development servers and are compiled out of production
  builds, through a build-time constant the sim reads without importing app or Vite code.
- `staggerShift` computes `(m <= ONE ? m : TWO - m) >> 1` with `m = row & (TWO - 1)` directly, which is
  bit-identical for the non-negative wave; keep it exact for negative rows or prove they never occur.
- Hash-identical.

## Verify

- The built bundle has no assert branch; a dev server and `npm test` still throw on a forced overflow.
- State hash unchanged over 2000 ticks from the reference's t100k checkpoint; the fixed-point and
  world-metric tests pass.
- `npm test`, `npm run check`, `npm run build`.
