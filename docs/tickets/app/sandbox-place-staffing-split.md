# Split game/sandbox/place.ts — staffing/XP helpers into their own module

## Problem

`packages/app/src/game/sandbox/place.ts` (~450 lines) mixes two concerns: entity placement helpers
(buildings, resource nodes, flags, drops) and crew staffing (`staffableCrewFor`, `staffBuildingFully`,
`spawnWorkersAtDoor`, `gatherMasteryExperience`). Review of the sandbox-village branch flagged it as a
natural split now that the staffing half grew the veteran-XP logic.

## Task

Move the staffing/XP helpers into `packages/app/src/game/sandbox/staffing.ts` (or similar), re-export
through the sandbox barrel so import paths stay stable. Pure refactor — no behavior change; scene
tests stay green as-is.
