# Rework and re-enable the building tech-unlock gate (`buildingEnabled`)

**Area:** sim (progression) + app · **Origin:** wider-build-clearance worktree 2026-07-19 · **Priority:** P2

## Context

`buildingEnabled` (`packages/sim/src/systems/progression/unlocks.ts`) is the read side of the
`jobEnablesHouse` tech-graph: a house type is unlocked for a tribe only once a settler of an enabling
job is alive (a smithy behind a smith, a barracks behind a soldier). It gates several systems:

- direct placement (`command/placement.ts` `placeBuilding`),
- building upgrades (`command/placement.ts` `upgradeBuilding`),
- job openings (`economy/jobs/openings.ts`),
- AI workplace + farming targeting (`agents/targets/workplaces.ts`, `agents/farming/planner.ts`).

**Why it was disabled:** the gate produced a confusing player-facing dead-end — the build-placement
overlay (`hud/tool-panel/placement.ts` `canPlaceAt` → sim `placementProbe`) checks only terrain and
collision, so a tech-locked building shows a *green* footprint, but the `placeBuilding` command then
silently drops at `buildingEnabled`. Player clicks a valid-looking tile and nothing appears. The
unlock rule is also meant to sit alongside the accrued-XP requirement half (`settlerMeetsNeed` /
`experienceRequirementMet`, the `needfor*` thresholds), i.e. the progression/experience system, which
is not yet wired into a playable loop. Rather than ship a half-working gate, the whole feature was
switched off.

**Current state (this branch):** `BUILDING_UNLOCK_GATE_ENABLED = false` in `unlocks.ts` makes
`buildingEnabled` always return `true`; every gate site above still calls it, so flipping the switch
back on restores the behaviour with no code move. `goodEnabled` / `jobEnabled` (production + job
specialization gates) are **untouched** — only the building/house gate is off.

## Scope

Design and re-enable the building-unlock progression as a coherent, player-legible feature:

1. Decide the intended model: pure `jobEnablesHouse` presence gate, or presence + accrued-XP
   threshold (tie-in to `progression/experience.ts`). Pin the source basis — extracted `tribetypes`
   `jobEnablesHouse` edges and the `needfor*` requirements are the data; the exact interaction with
   experience/XP is unobserved and must be named as an approximation.
2. Close the overlay/command mismatch: the placement overlay (and the building menu) must reflect the
   unlock state so a locked building reads as locked (greyed/disabled), never a green footprint that
   drops on click. This is the core UX fix — the reason the feature was pulled.
3. Re-enable by setting `BUILDING_UNLOCK_GATE_ENABLED = true` (or removing the switch) once 1–2 hold.
4. Un-skip the coupled tests (search for the ticket filename): `packages/app/test/sandbox-tech-graph.test.ts`
   and any sim tests parked in the same commit that disabled the gate.

## Verify

- With the gate on: a tech-locked house cannot be placed/upgraded/staffed until its enabler exists,
  AND the overlay/menu shows it as locked (no green-then-drop). Add an app acceptance scene + headless
  assertion for the overlay state, plus a human browser pass on the menu/overlay.
- `npm test`, `npm run check`, `npm run build`; if a golden moves, it is the intentional re-enable —
  name it in the commit.
