# Stop rebuilding `indexById` maps inside per-command / per-spawn sim handlers

**Area:** sim · **Origin:** data+pipeline refactor review (deferred finding), 2026-07-13 · **Priority:** P3

`@vinland/data`'s `indexById(items)` (`packages/data/src/lookup.ts`) builds a fresh
`Map<number, T>` on every call — its doc even says "build maps once, index many times." Four sim
call sites instead call it **inside** a per-command / per-spawn handler, so they rebuild the whole
map from the content table every invocation (re-verify with a grep for `indexById(` under
`packages/sim/src` — line numbers drift):

- `packages/sim/src/systems/command/index.ts:211` — the `debugFillStockpile` command handler,
  `indexById(ctx.content.buildings)`
- `packages/sim/src/systems/command/placement.ts:51` — `placeBuilding`,
  `indexById(ctx.content.buildings)`
- `packages/sim/src/systems/conflict/spawn.ts:62` — `createSettler`, `indexById(content.jobs)`
- `packages/sim/src/systems/orders/work.ts:45` — the `setJob` command handler,
  `indexById(ctx.content.jobs)`

The content tables are small, so this is not `entities²` — but it is avoidable per-call allocation
on the command/spawn path (RTS-scale budget, root `AGENTS.md` rule 6), the same class of hot-path
rebuild the content-index work already eliminated for the query systems
(`packages/sim/src/core/content-index.ts`).

## Why this is deferred from the data+pipeline refactor

The finding surfaced diagnosing `packages/data`, but `indexById` itself is a fine leaf helper — the
defect is in the **sim consumers**, which is out of scope for a data+pipeline pass. The fix belongs
with the sim's existing content-index memoization, not the data package.

## Scope

- Route these four call sites through a **memoized** index rather than a per-call rebuild. The
  established pattern is `core/content-index.ts` (WeakMap-memoized O(1) maps over a `ContentSet`,
  each reproducing the duplicate-key semantics of the scan it replaced) — add the
  building/job `typeId` indexes there (or reuse an existing one) and have the handlers read
  the memoized map.
- Keep the returned lookup's semantics identical (last-wins on duplicate `typeId`, same
  `ReadonlyMap<number, T>` shape) so no decision changes — this is a pure allocation/perf fix.
- Separately, note that `core/content-index.ts:126` hand-rolls the one non-`typeId` table
  (`new Map(content.landscapeGfx.map((g) => [g.index, g]))`) because `indexById` is
  `typeId`-only. If a second non-`typeId` caller ever appears, generalize to a keyed
  `indexBy(items, key)`; with one caller today, do **not** over-generalize.

## Verify

- Goldens must stay byte-identical (`npm test`) — this changes no decision, only when the map is
  built. Register any new incrementally-maintained cache in `World.verifyCaches()` if applicable.
- Confirm the handlers no longer allocate a map per call (read the diff; the index is built once and
  memoized on the `ContentSet`).

Source basis: observed hot-path allocation; the fix mirrors the landed content-index memoization
(`packages/sim/AGENTS.md` "Scaling to thousands of units").
