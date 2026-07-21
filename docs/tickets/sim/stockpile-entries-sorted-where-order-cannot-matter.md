# Stop sorting a store's goods where the result cannot depend on order

**Area:** sim · **Priority:** P3

`stockpileEntries` (`components/economy/infrastructure.ts`) allocates an array of pairs and sorts it on
every call. It exists so a *pick* over a store's goods is canonical, but three per-tick callers use it
where AGENTS.md Ordering says canonicalization is not needed ("Do not sort membership checks,
commutative sums, or loops whose result cannot change with order"):

- `hasHaulableOutput` (`systems/agents/targets/stores/outputs.ts`) — a boolean existence check, and the
  AI planner's per-tick haul dormancy gate over **all** stockpiles (`systems/agents/ai.ts`). Order
  cannot change a `return true`.
- `storedFoodUnits` (`systems/family/households.ts`) — a commutative integer sum, reached per home-store
  candidate from the hungry-settler food scan and from the child-making checks.
- `storedFoodGood` (`systems/agents/targets/food.ts`) — a min-pick that sorts the whole goods map and
  then returns on the first match, once per candidate store inside a ring scan. The winner is
  load-bearing, so this one becomes a min-over-`amounts` scan rather than an unordered walk.

Each store declares a slot per catalog good (~50 in a warehouse), so this is a sorted array per store
per probe on paths that already run thousands of times per tick.

## Scope

Walk `stock.amounts` directly in the first two; replace the third with an allocation-free minimum scan
that returns the same goodType. Leave `consumeFoodUnits` (`households.ts`) alone — it genuinely
consumes in ascending order.

Do not widen this into a `stockpileEntries` audit: the other callers are real canonical picks.

## Verify

Goldens and `hashState` byte-identical (this is behavior-preserving). `npm test`, `npm run check`,
`npm run build`. `npm run bench:sim` to confirm the `ai` system's dormancy gate got cheaper.
