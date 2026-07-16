# Confine the remaining autonomous drives to the signpost navigation area

**Area:** sim (signposts / agents) · **Origin:** signposts feature branch, 2026-07-16 · **Priority:** P2

The signpost confinement (`systems/signposts/`, `setSignpostNavigation`) gates NEW work-target
acquisition — harvest nodes, collectable trunks, fetch stores, construction sites, work-flag
placement, and `moveUnit` goals. Three drive families were deliberately left unconfined on the
feature branch (named approximation, so goods never strand mid-haul and needs never dead-lock):

- **Deliveries of an already-carried load** (`planDelivery` / `deliveryTargetFor` /
  `nearestStoreFor` sinks) — a loaded settler may today walk to an out-of-area store.
- **Needs satisfier search** (eat/sleep/pray target buildings, `drives-needs.ts`) — a hungry
  settler may seek food beyond its area.
- **Berry foraging** — `economy/berries.ts` `BERRY_FORAGE_RADIUS` still carries its "flat radius is
  the interim rule until the planned signpost system" comment; the system now exists but forage is
  not wired to `navigationLimitFor`.

Source basis: observed original behaviour — settlers do not act outside the guidepost network at
all; the split above is ours, not the original's.

## Scope

- Thread `cellGateOf(plan.limit)` (or `navigationLimitFor`) into the three families, with an
  explicit decision per family on the stranding case (e.g. a carried load with no in-area sink:
  drop in place? hold?). Update the berries comment to reference the shipped system.
- Keep default-off behaviour byte-identical (goldens untouched); extend
  `packages/sim/test/signposts/navigation.test.ts` per family.

## Verify

`npm test` (goldens unmoved), new navigation tests cover each family on/off.
