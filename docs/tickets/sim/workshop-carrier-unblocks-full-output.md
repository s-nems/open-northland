# Have a bound carrier clear a blocking output before fetching inputs

**Area:** sim · **Priority:** P3

`planWorkshopSupplier` (`packages/sim/src/systems/settlers/drives/economy/workshop/index.ts`) tops up
inputs before hauling output. With a full output shelf and an under-capacity input, its bound carrier
can make an input trip that leaves production blocked. Craftsmen can haul their own blocked output,
but this does not help while they are absent or seated.

The bound supplier already runs before general porter work in `drives/ladder.ts`, but that rung
always claims the carrier. When the supplier has no work it waits at its pickup flag or loiters,
preventing the wider settlement's hauling fallback. Both output-first unblocking and availability
for general hauling remain to implement. Original behavior: the workshop's carrier fetches a missing
input before it carries any output out, so output-first unblocking is a departure that needs the
owner's ruling. It looks for inputs only within about 20 nodes of its work centre, though, and carries
output out when none lies there (unconfirmed in a running game); our supplier searches the whole goods
search limit, so a far input keeps it from ever clearing the shelf.

## Scope

- When the workshop has shelf-blocking output that can be delivered, haul it through the existing
  `walkPickupBatch`/delivery path before searching for missing inputs, choosing among several blocked
  outputs as the craftsman drive's `blockedOutputToHaul` does. Preserve ordinary supply and pickup-flag source preference.
- Keep the bound carrier available to the wider settlement when its workshop has no blocking work.
  Let it take useful general hauling rather than always claiming the planner rung and idling locally;
  reuse the existing hauling fallback. Cover any operator-presence and pickup-flag constraints.

## Verify

- Planner test: a blocked workshop with no craftsman and an under-capacity input makes its bound
  carrier lift the blocking output before fetching input. No available output destination leaves
  ordinary input supply working.
- With no blocking workshop work and a useful settlement haul waiting, the bound carrier takes that
  haul. Cover pickup-flag and carrier-as-operator cases so general work respects their constraints.
- Compare shelf levels and blocked-production duration on a comparable real-map run; the former
  supplier-drive frequency observation does not describe the current ladder.
- `npm test`, `npm run check`, and `npm run build`; name any intentional golden movement.
