# The warehouse scene employs nobody on real content (tech-gate catch-22)

**Area:** app (scenes) · **Origin:** right-click-assign investigation, 2026-07-15 · **Priority:** P2

The `warehouse` acceptance scene spawns three **jobless** settlers next to a `stock_00` (buildingType 7)
and relies on the JobSystem to employ them into its carrier slots. That works headless (sandbox content
has no tech graph) but **breaks in the browser on real content**: the settlers stay idle and never become
carriers, so the hauling demo shows nothing move.

## Root cause

Real content's viking tribe (typeId 1) carries a `jobEnables` tech graph. The warehouse (house 7) is gated
`jobEnablesHouse` on a **collector (8) or farmer (18)** being alive in the tribe (`tribeUnlockEnabled`,
`packages/sim/src/systems/progression/unlocks.ts`). The scene has neither — only jobless settlers — so
`buildingEnabled(7)` is false and every employment path (auto and the `assignWorker` command) no-ops. The
catch-22: the warehouse needs an enabling-job settler to employ anyone, but the scene provides none. In a
real game the ungated HQ bootstraps the first gatherers; this scene has no HQ.

A second, related gate compounds it: outdoor trades have a `needforjob` XP threshold
(`settlerMeetsNeed`), so a fresh 0-XP settler may still not qualify for some slots even once the building
is enabled. Confirm whether carrier (24) is XP-ungated (it appears to be) so the intended demo works.

## Scope

- Make the scene self-sufficient on real content: give it an enabling-job settler (a collector or farmer),
  or spawn the carriers pre-jobbed as `carrier`, or add an HQ — whichever keeps the demo honest.
- Keep the headless twin green: the sandbox path already employs 3 carriers; whatever is added must not
  change that count/assertion (a separate enabler settler must not occupy a carrier slot).
- Consider whether other real-content scenes with gated workshops (any without their enabler present) have
  the same latent gap; the chain scene is fine because its farmers enable house 7.

## Verify

- `npm test` — the warehouse scene mechanic still passes headless.
- Browser `?scene=warehouse` on real content — the three settlers become carriers and haul the loose piles
  into the store (the thing a human is meant to watch). User's eyes on the motion.

## Note

This is a pre-existing gap surfaced during the 2026-07-15 right-click-assignment fix (it predates that
work — scenes have run on real content since the interactive-entries switch). It is **not** the cause of
the "right-click assigns Myśliwy instead of Tragarz" bug, which was a worker-role misclassification fixed
on this branch (`assignmentPriority`/`workerRoleOf` now recognize the raw real gatherer ids).
