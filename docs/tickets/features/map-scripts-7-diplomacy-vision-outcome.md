# Execute the diplomacy, exploration, AI-flag, and win-or-lose opcodes

**Area:** sim · **Focus:** `systems/missions` · **Priority:** P2

Map-scripts epic, stage 7 of 10. Reference: [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md),
"Player state the goals read". Depends on the skirmish match state (`MatchRules`, the
`setMatchParticipants` command, and the mission window) from the victory-defeat branch being on
`main`; check `git log` before starting.

`SetDiplomacy` (632 lines) and `ExploreArea` (1,412) shape almost every map's opening;
`MissionWon` and `MissionFailed` (230) are how authored maps end; `PlayerDied` (223 goals) and
`PlayerSeen` (147) drive their turning points.

## Scope

- Results `SetDiplomacy` (one direction per line; the sim's `setDiplomacy` command already takes
  `from`, `to`, `state` the same way), `SetDiplomacyNotChangeableFlag` (symmetric lock that the
  player's diplomacy command respects), `ExploreArea` (any zero coordinate or range reveals the
  whole map), `SetExternalFlag` (the AI condition flags from `ai.inc`; coordinate with the HAI
  extraction ticket in `docs/tickets/pipeline/`), `MissionWon` and `MissionFailed` mapped onto the
  match state so the existing end-of-match presentation shows the result.
- Goals `DiplomacyState`, `PlayerAttackedByPlayer` (set when a player's human is damaged),
  `PlayerSeen` (set from the vision system when another player's unit or building enters view;
  record it as an approximation until observed), `PlayerDied` (reads the match dead flag; the
  original's rule of no adult male human every 125 ticks after tick 720, with `playerneverdies`,
  belongs to the match system and is noted there), `FindPos`, `FindHumans`, `FindVehicles`,
  `FindHouses`, `FindAnimals` (explored-point tests).
- Non-goals: multiplayer goals, tributes.

## Where to look

`packages/sim/src/core/commands/administration.ts` (`setDiplomacy`), `systems/vision/state.ts`
(explored and seen state), `components/match.ts`, `systems/ai-player` (external flags),
`systems/conflict` (damage hook).

## Verify

Headless: a scripted stance change refuses a player command when locked; a whole-map reveal sets the
explored mask; `MissionFailed` ends the match for the player. Coverage delta. Normal gates.
