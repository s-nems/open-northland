# Move the AI opening build order from code data into a content-IR profile

**Area:** sim + content schema · **Origin:** ai-player build-order execution 2026-07-17 · **Priority:** P3

`DEFAULT_BUILD_ORDER` (`packages/sim/src/systems/ai-player/build-order.ts`) is a const table of
stable content ids inside the sim — data in shape, but not authorable per scenario. The original
ticket wanted a validated content shape under the IR so AI profiles can differ per map/difficulty.
No extraction source exists (the original's HAI internals are binary), so this is authored content,
not pipeline output.

Scope: a Zod `z.strictObject` schema (e.g. `schema/economy/ai-profile.ts`) with an ordered
`{building, count}` list per profile id, a `.default([])` ContentSet field, a memoized lookup, and
`buildOrderModule` resolving the seat's profile (falling back to the current default table).

## Verify

- Schema round-trips through `parseContentSet`; a fixture profile drives the executor in the
  existing module tests; `npm test`, `npm run check`, `npm run build`.
