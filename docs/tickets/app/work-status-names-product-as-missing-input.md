# Name the missing ingredients in workshop status

**Area:** app, sim · **Priority:** P2

`systems/readviews/work-status.ts` returns `waitingInput.goodType` as the product the workshop
wants to make. Both `settler-panel.ts` and `building-status.ts` put that name after
"brak surowców:" / "no inputs:". A worker waiting for wood to make planks therefore reports
missing planks. The status cannot name which ingredient is missing from a multi-input recipe.

## Reproduce

Use the forge setup in `packages/sim/test/economy/production-system/work-status.cases.ts`:
zero wood, a qualified carpenter, and only product `FOOD` selected. Its recipe consumes wood.
`Simulation.workStatus(smith)` returns `{ kind: 'waitingInput', goodType: FOOD }`.
Passing a `waitingInput` result to the settler panel renders its `goodType` as the missing
material. Both results were confirmed with focused Vitest probes; existing status tests pin
the product payload but do not check the meaning of the composed message.

## Scope

- Keep the intended product distinct from its missing ingredients in the sim read seam.
- Report ingredient types and shortages against the selected recipe's current stock. Do not
  describe an ingredient as unavailable throughout the settlement merely because the workshop
  lacks it.
- Update the settler and building panel text in both locales. For example, distinguish
  "waiting for water and honey" from the product being made.
- Preserve recipe selection and production behavior. The broader explanation of a failed
  work search belongs to [idle-work-blocker-details](idle-work-blocker-details.md).

## Verify

- A one-input recipe names its ingredient, not its product.
- A two-input recipe with one stocked ingredient names only the other shortage; partial stock
  reports the remaining amount correctly.
- Settler and building panels render the same reason through inline and worker session hosts.
- Run the production work-status and panel-model tests, standard gates, and a verified preview
  with a starved workshop.
