# Explain why an assigned settler cannot find work

**Area:** app, sim · **Priority:** P2

The idle notification tells the player that an assigned settler has nothing to do without
explaining what prevents work. `messages/from-snapshot.ts` raises `nothingToDo` after ten idle
sweeps based on occupation and assignment alone. It does not carry a work blocker.

The settler panel only partly fills that gap. `systems/readviews/work-status.ts` reports a
gatherer's stopped production counters, but does not inspect resource availability, output
space or the result of its work search. A woodcutter in a world with no resources returns
`undefined` from `Simulation.workStatus`; this was confirmed with the production test fixture.
An idle worker then has no detail in `settler-panel.ts`. A staffed building with no reported
blocker can also fall through to the green "working" status in `building-status.ts`.

## Scope

- Expose the reason the work planner could not take useful work, with the relevant good or
  workplace when known. Cover no eligible resource in the work area, no output destination
  with room, unavailable recipe inputs, and production stopped by the player's selection.
- Distinguish a confirmed routing failure from lack of a candidate. Use an unknown reason
  when the planner cannot establish more; do not infer that the map lacks a resource from one
  failed route.
- Reuse planning decisions or a bounded read for the selected worker. Do not add a world-wide
  path search for each HUD refresh or idle notification.
- Show the explanation in the selected settler's panel and make it accessible from the idle
  notification. Refresh or clear it when work, selection, assignment or the blocking condition
  changes. Keep the separate lost-way indication meaningful.
- Do not show a staffed building as working solely because its worker has no diagnostic.
- Coordinate ingredient naming with
  [work-status-names-product-as-missing-input](work-status-names-product-as-missing-input.md).

## Verify

- Small deterministic setups: no gatherable resources, full output storage, missing workshop
  inputs, and all products stopped. Each names the actual blocker.
- Supply the missing resource or storage room, or enable a product: work resumes and the stale
  explanation disappears. A worker actively transporting inputs is not reported as idle.
- Verify worker-host answers and selected-panel cache invalidation, plus notification retirement.
- Run standard gates and inspect a registered scene with several distinct stalls in a verified
  preview. Report the cost at settlement scale if diagnostic work runs during planning.
