# Apply authored `setproducedgood` picks to workshop craft selections

**Area:** sim + app · **Priority:** P3
**Blocked by:** [authored house attachments](../pipeline/map-attachtohouse-import.md)

`setproducedgood` is the original's per-human **produced good**, not only a gatherer's resource pick, and
it is authored for workshop trades too. The import chain now lands it on `WorkFlag.goodType`
(`stampGatherGood`, `packages/sim/src/systems/conflict/spawn/settlers.ts`), which covers 573 of the
decoded corpus's 819 picks. The remainder is dropped and the drop is named in that function's doc. This
ticket is the follow-up for the part that is a real gap.

Measured breakdown of the 246 that do not land (re-measure before acting — counts drift with content):

- **~47 workshop products** (`baker` → `bread` ×11, `joiner` → `tool_wooden` ×8, `miller` → `flour` ×6,
  `potter` → `brick` ×6, `smith`, `mason`, `sewer`, `brewer`, `druid`, `armorer`). **The real gap.**
- **86 `„gold”`** — a source typo covered by
  [typographic-quoted values](../pipeline/setproducedgood-typographic-quotes.md). Not this ticket.
- **62 `fisher` → `fish`** — `fish` carries no harvest atomic and `fisher` no harvest grant, so no work
  flag exists to narrow. Only actionable if fishing ever becomes flag work.
- **38 `hunter` → `prey` / 13 `farmer` → `wheat`** — **no action needed, do not "fix" these.** `prey` is
  the resource, not a good; the hunter falls back to every good it can harvest (`leather` + `meat`, both
  harvest atomic 33), which is what hunting prey yields. A farmer is bound to its farm by the farming
  rule (`jobCanHarvest`), never a flag gatherer.

## Scope (the workshop half)

- `setCraftGoods` (`packages/sim/src/systems/orders/work.ts`) already models a per-settler product
  selection as `CraftSelection` — the natural home for `baker` → `bread`.
- `setCraftGoods` requires a bound workplace (`JobAssignment`), which an imported settler only gets
  once `attachtohouse` imports. Both
  verbs sit in the same `sethuman` block, and employment changes REMOVE the selection — so attach first,
  pick second, or the pick is wiped.
- Keep the `spawnSettler` seam honest: either a second field or one product-neutral field that routes to
  the flag or the craft selection by what the trade is. Do not silently widen `gatherGood`.

## Verify

- `npm test`; extend `packages/sim/test/agents/gatherer-flag/yard/commands.cases.ts` (the spawn-pick
  cases) and `packages/app/test/content/authored-map-gather-good.test.ts`, whose `fisher` row already
  pins one known drop.
- `npm run test:content`; re-count how many of the 819 land, and state the new number.
