# A restricted operator is held inside for a work seat its craft selection cannot use

**Area:** sim (settlers/drives/economy) · **Origin:** equipment hand-out, 2026-07-27 · **Priority:** P1

`workSeatCount` (`systems/settlers/drives/economy/workshop/supply.ts`) counts the further cycles a workplace
could start as the MAX of `startableCycleCount` over **every** recipe the type declares. It never
consults the operator's `CraftSelection`. `startCycleFor` (`systems/economy/production/rotation.ts`)
does: a selection naming products the workplace makes filters the pool down to those, and only an
ORPHANED selection (nothing the workplace makes, or nothing earned) degrades to the all-products
default.

So a workplace whose stock can start recipe A, while its operator is restricted to recipe B, offers a
seat that operator can never take. `planProducer` (`workshop/index.ts`) pins it inside via
`holdInsideWorkplace`, and it never falls through to the input-fetch rung that would go get B's
missing input. `workSeatCount`'s own docstring claims "the planner and the producer never disagree
about whether a cycle can run" - `CraftSelection` breaks exactly that.

## Measured

`magiczny_las`, six AI seats, 30 000 ticks, on a branch off `138fe685` with every seat's assistant
granted (so AFTER `48a8fa89`'s producer input-reserve rule and its second joiner): the map produces
**zero `tool_wooden`, zero `tool_iron`, zero `shoes`** while mead flows freely (249 units here, ~195
on a second run - the control good), counted off `goodProduced`. Worn-tool and worn-boots coverage is
`0/N` for every trade on every seat - the equip hand-out works, the goods never exist.

Every seat has `work_joinery_01` built with a `joiner` employed. Its shelf against the seat's iron:

| seat | seat-wide iron | joinery holds | cycles |
|------|-----|---------------|--------|
| p0 | 53 | `wood:2` | 0 |
| p1 | 67 | `wood:4` | 0 |
| p3 | 35 | `wood:4` | 0 |

The AI restricts the joinery to iron tools (`CRAFT_RESTRICTIONS_BY_BUILDING_ID` in
`systems/ai-player/workforce/craft.ts`, user plan 2026-07-26). The wood on the shelf makes the
wood-only `tool_wooden` recipe startable, so the seat gate says "stay"; the selection says "only
`tool_iron`" and there is no iron. The joiner stands in the shop forever.

The brewery is not a control group for this - it carries no restriction, so its seat gate and its
operator agree. Nor is the pottery, the only other restricted building: any stock that starts its
`crockery` recipe also starts the `brick` its restriction names, so it cannot reach the trap.

## Scope

Make the seat gate agree with the start gate: count only cycles the prospective operator could
actually start, or free an operator whose selection has nothing startable so it reaches the fetch
rung. Beware the reverse deadlock - the operator that leaves must be the one that comes back with the
input.

Do NOT change the joinery's iron-only restriction as part of the fix; whether the seat should craft
wooden tools at all is a balance call for the user, and widening it would hide this bug behind a shop
that suddenly runs on the wood it already holds.

Related but distinct: `finish-the-producer-input-reserve-rule.md` owns the DELIVERY side (a full
input slot with no way back out, and the fetch rungs that still strip reserves). This one is the
planner's seat gate, and it fires even when the input never arrived at all.

Also observed, not diagnosed: `leather` is 0 on every seat, so `work_sewery_01` spends its wool on
`armor_wool` and never makes shoes. Separate chain.

## Verify

- A real-map run reports non-zero `tool_iron` production and a non-zero worn-tool count on the
  working trades. No soak harness exists; the nearest host is the flagged real-content run in
  `packages/app/test/content/ai-map-scenario.test.ts` (same `magiczny_las` + AI seats), which boots
  120 ticks and would need a longer horizon for this measurement.
- A focused unit test: a workplace holding only recipe A's inputs, with its operator selected onto B,
  frees that operator instead of holding it inside.
- `npm test`, `npm run test:content`. Golden state hashes must not move without a named reason.
