# Report a missing input out of reach when the producer's own fetch cannot take it

**Area:** sim, app · **Priority:** P3

The work panel's `waitingInput` status (`packages/sim/src/systems/readviews/work-status.ts`) marks each
missing input reachable through `storeReach` (`readviews/store-reach.ts`), which tests only the worker's
signpost area and answers "in reach" once it has weighed 128 candidates. The producer's fetch
(`nearestMissingInputSource` in `systems/settlers/drives/economy/workshop/supply.ts`) searches from the
workshop door and also applies the goods search limit (`goodsGate` in `settlers/targets/bands.ts`, from
`goodsSearchLimitAt`). A source inside the signpost area but past that limit therefore reads "in reach"
while nobody walks to it.

On a three-player island save, all 45 missing inputs read "in reach". The fetch found no source for 15 of
them, and those 15 operators stood idle 82-99% of a 20000-tick run while the panel offered their input as
available. Players report this as workers stopping with everything they need in stock.

## Scope

- Judge an input's reach with the fetch's own gate from the workshop door, so "in reach" means the
  producer would walk to it; keep the panel's other reasons as they are.
- Keep the readview's cost bounded for one inspected settler. A capped answer must not claim reach the
  gate denies; with no answer within the cap, say nothing rather than "in reach".

## Verify

- Readview test: a store holding the input inside the signpost area but beyond the goods search limit
  from the door reports it out of reach; one within the limit reports it in reach.
- `npm test`.
