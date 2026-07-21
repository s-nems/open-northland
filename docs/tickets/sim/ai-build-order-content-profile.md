# Move the AI opening build order from code data into a content-IR profile

**Area:** sim + content schema · **Priority:** P3

`DEFAULT_BUILD_ORDER` (`packages/sim/src/systems/ai-player/build-order/entries.ts`) is a const
table of stable content ids inside the sim — data in shape, but not authorable per scenario. The
original ticket wanted a validated content shape under the IR so AI profiles can differ per
map/difficulty. No extraction source exists (the original's HAI internals are binary), so this is
authored content, not pipeline output.

## Scope

Add a Zod `z.strictObject` schema (e.g. `schema/economy/ai-profile.ts`) mirroring the
`BuildOrderEntry` union (ordered `place` — with `near` affinities and the `ground` rule — /
`upgrade` / `collector` entries) per profile id, a `.default([])` ContentSet field, a memoized
lookup, and `buildOrderModule` + `workforceModule` resolving the seat's profile (falling back to
the current default table). The workforce's `CARRIER_STAFFED_BUILDING_IDS` (`workforce.ts`) is the
same kind of authored data and should ride the profile too.

## Verify

- Schema round-trips through `parseContentSet`; a fixture profile drives the executor in the
  existing module tests; `npm test`, `npm run check`, `npm run build`.
