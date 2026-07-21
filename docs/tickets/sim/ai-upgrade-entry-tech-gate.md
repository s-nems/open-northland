# Make the AI build order respect the tech gate before issuing upgrades

**Area:** sim · **Priority:** P3
**Blocked by:** [building unlock gate](rework-building-unlock-gate.md)

An `upgrade` build-order entry picks its candidate (`build-order/progress.ts` `upgradeCandidate`)
without checking `buildingEnabled` for the target tier, while the `upgradeBuilding` command skips a
tech-locked target (`systems/command/placement.ts`). A seat whose tribe has not unlocked the next
home/workshop tier therefore re-issues a skipped `upgradeBuilding` every decision (one log entry
per `AI_DECISION_INTERVAL_TICKS`) and the list stalls there until the unlock happens organically.
Self-healing but noisy, and the stall is invisible in the log (the command looks accepted).

## Scope

Gate `upgradeCandidate` (or the executor's `upgrade` arm) on
`buildingEnabled(world, ctx, tribe, target.typeId)` so a locked tier stalls quietly without
enqueueing, and cover it with a module test using a tribe whose unlock is absent.

## Verify

- Module test: a locked upgrade target yields no command (and no log growth) until unlocked;
  `npm test`, `npm run check`, `npm run build`.
