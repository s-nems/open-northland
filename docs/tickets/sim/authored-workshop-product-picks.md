# Apply authored `setproducedgood` picks to workshop production counters

**Area:** sim, app · **Priority:** P3

`setproducedgood` is the original's per-human **produced good**, not only a gatherer's resource pick, and
it is authored for workshop trades too. The import chain now lands it on a flag gatherer's
`ProductionCounters` (`stampGatherGood`, `packages/sim/src/systems/spawn/settlers.ts`), which covers 573
of the decoded corpus's 819 picks. The remainder is dropped and the drop is named in that function's doc. This
ticket is the follow-up for the part that is a real gap.

The blocker is gone: `attachtohouse` now imports, so an authored workshop settler reaches a bound
`JobAssignment` as it spawns. That import costs almost nothing here: 67 of the 174 attached humans also
carry a `setproducedgood`, but only 16 are in a trade whose `allowedAtomics` cover the pick's harvest
atomic at all, and 13 of those 16 are farmers, who are farm-bound rather than flag gatherers. So at most
three collectors lose a flag their pick used to narrow, not the whole overlap. Re-measure before acting.

Measured breakdown of the 246 that do not land (re-measure before acting - counts drift with content):

- **~47 workshop products** (`baker` → `bread` ×11, `joiner` → `tool_wooden` ×8, `miller` → `flour` ×6,
  `potter` → `brick` ×6, `smith`, `mason`, `sewer`, `brewer`, `druid`, `armorer`). **The real gap.**
- **86 `„gold”`** - a source typo covered by
  [typographic-quoted values](../pipeline/setproducedgood-typographic-quotes.md). Not this ticket.
- **62 `fisher` → `fish`** - use the fisher's work flag as the catch-delivery yard; the dedicated
  fishing drive selects authored `lafm` swarms and can produce only fish. These rows still do not land as
  counters, but no gameplay choice is lost.
- **38 `hunter` → `prey` / 13 `farmer` → `wheat`** - **no action needed, do not "fix" these.** `prey` is
  the resource, not a good; the hunter falls back to every good it can harvest (`leather` + `meat` +
  `wool`, all harvest atomic 33), which is what hunted carcasses yield. A farmer is bound to its farm by
  the farming rule (`jobCanHarvest`), never a flag gatherer.

## Scope

- `setProductionGoods` (`packages/sim/src/systems/orders/work/selection.ts`) already models a per-settler
  product choice as `ProductionCounters`, for a craft worker and a gatherer alike - the natural home for
  `baker` → `bread`.
- A craft worker's products come from its bound workplace (`JobAssignment`), which an imported settler now
  gets from its `attachtohouse`. Employment REMOVES the counters (`bindEmployment`), so the pick has to be
  applied after the attachment; `spawnSettler` already runs them in that order.
- Keep the `spawnSettler` seam honest: either a second field or one product-neutral field that writes the
  counters by what the trade makes. Do not silently widen `gatherGood`.

## Verify

- `npm test`; extend `packages/sim/test/settlers/gatherer-flag/yard/commands.cases.ts` (the spawn-pick
  cases) and `packages/app/test/content/authored-map-gather-good.test.ts`. Its `fisher` row pins the
  intentional no-flag path used by the dedicated fishing mechanic.
- `npm run test:content`; re-count how many of the 819 land, and state the new number.
