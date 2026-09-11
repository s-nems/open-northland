# Enable mission scripts by default and accept them on a real map

**Area:** sim, app · **Focus:** acceptance · **Priority:** P2

Map-scripts epic, stage 10 of 10. Check the coverage report before starting.

The implemented executors cover only part of the map behavior. `MissionRules` still defaults to off and only `?missions=on` turns a
script on, so players never see one run. This stage flips the default, proves a campaign map end to
end, and records what the original confirms.

## Scope

- Before enabling scripts, evaluate the chosen map's unsupported opcodes and partial executors:
  `Allow*` and `SetExternalFlag` currently store flags with no gameplay consumer, and the building
  unlock gate is disabled. Static opcode coverage cannot establish that a campaign is completable.
- Check the documented terrain approximations against the original: FX removal memberships differ
  between the shipped reference and the macOS reading; vertex colors use the owned palette with an
  approximated RGB multiplier. `SetLandscape` can show and block with a chest but does not implement
  its interaction or payload, and its final flag has no confirmed behavior here.
- Flip the `MissionRules` default to on after acceptance; keep the flag and the `?missions=` override
  for tests.
- Decide the fog default for a scripted map. With fog off, `PlayerSeen` and the explored-point goals
  (`FindPos`, `FindHumans`, `FindHouses`, `FindAnimals`) hold at once and `ExploreArea` writes
  nothing, so a campaign map's first-contact missions fire on the first pass; today only the `?fog=`
  override turns fog on.
- Declare the match seats a scripted map needs. `PlayerDied` (223 corpus goals) reads the match
  rule's dead flag, which only a contested match sets, and the app declares the controlled seat plus
  the `?ai=` seats minus `playerneverdies`; a scripted map launched without `?ai=` has one
  participant and nobody ever dies. [match-participants-from-in-use-seats.md](match-participants-from-in-use-seats.md)
  covers the seat source.
- Observe on the original whether a new tribute gets any cue beyond the diplomacy window (most corpus
  `CreateTribute` lines share no mission with a cutscene or info line); a cue this build adds would be
  its own, so decide it here with the messages branch in mind.
- Register an acceptance scene on a real campaign map (the CnMod `cn_1` or the base game's first
  mission) that lists fired missions and their tick, and update `docs/SCENES.md`.
- Exercise save/load during the accepted scenario. Persistent marker and weather overlays currently
  live only in app event caches and disappear on restore; either restore them from saved sim state
  or explicitly exclude dependent scenarios from the fidelity claim.
- Update golden hashes only where a scenario deliberately includes a scripted map; state every moved
  hash in the commit.
- Observe the original for the timing constants in the open questions of
  [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md) and rewrite those readings as observations
  or corrections. That includes whether the load tick evaluates: if the opening briefing shows before
  the map moves, add the load pass to the mission system so a scripted map's intro opens at once
  instead of three seconds in, and retime the mission tests that count from the first pass.
- Vehicles, sub-missions, chests, guides, wall gates, campaign map unlocks, the FMV opcode, and the
  `NumberOfGoodsTraded` goal (three corpus lines; no trade ledger exists to count) stay
  unsupported and reported; file tickets for them only when their systems exist. The authored
  `vehicles` and `guides` lanes are already extracted and wait for those systems.

## Where to look

`packages/app/src/scenes/` and `docs/SCENES.md`, `docs/TESTING.md` (golden hashes),
`packages/sim/src/components/rules.ts`.

## Verify

Full gates on merged `main` (`check:assets`, `check:docs`, `check`, `build`, `test`, `test:content`),
the coverage report identifying remaining unsupported and partial behavior, and a human run of the acceptance
scene with the intro briefing, the first wave, and the map's ending.
