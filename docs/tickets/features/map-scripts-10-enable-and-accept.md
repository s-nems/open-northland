# Enable mission scripts by default and accept them on a real map

**Area:** sim, app · **Focus:** acceptance · **Priority:** P2
**Blocked by:** [map-scripts-8-tributes.md](map-scripts-8-tributes.md)

Map-scripts epic, stage 10 of 10. Also needs stage 9 merged; check the coverage report before
starting.

With the executors in place, `MissionRules` still defaults to off and only `?missions=on` turns a
script on, so players never see one run. This stage flips the default, proves a campaign map end to
end, and records what the original confirms.

## Scope

- Flip the `MissionRules` default to on; keep the flag and the `?missions=` override for tests.
- Decide the fog default for a scripted map. With fog off, `PlayerSeen` and the explored-point goals
  (`FindPos`, `FindHumans`, `FindHouses`, `FindAnimals`) hold at once and `ExploreArea` writes
  nothing, so a campaign map's first-contact missions fire on the first pass; today only the `?fog=`
  override turns fog on.
- Declare the match seats a scripted map needs. `PlayerDied` (223 corpus goals) reads the match
  rule's dead flag, which only a contested match sets, and the app declares the controlled seat plus
  the `?ai=` seats minus `playerneverdies`; a scripted map launched without `?ai=` has one
  participant and nobody ever dies. [match-participants-from-in-use-seats.md](match-participants-from-in-use-seats.md)
  covers the seat source.
- Register an acceptance scene on a real campaign map (the CnMod `cn_1` or the base game's first
  mission) that lists fired missions and their tick, and update `docs/SCENES.md`.
- Update golden hashes only where a scenario deliberately includes a scripted map; state every moved
  hash in the commit.
- Observe the original for the timing constants in the open questions of
  [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md) and rewrite those readings as observations
  or corrections.
- Vehicles, sub-missions, chests, guides, wall gates, campaign map unlocks, the FMV opcode, and the
  `NumberOfGoodsTraded` goal (three corpus lines; no trade ledger exists to count) stay
  unsupported and reported; file tickets for them only when their systems exist. The authored
  `vehicles` and `guides` lanes are already extracted and wait for those systems.

## Where to look

`packages/app/src/scenes/` and `docs/SCENES.md`, `docs/TESTING.md` (golden hashes),
`packages/sim/src/components/rules.ts`.

## Verify

Full gates on merged `main` (`check:assets`, `check:docs`, `check`, `build`, `test`, `test:content`),
the coverage report showing every stage's opcodes as supported, and a human run of the acceptance
scene with the intro briefing, the first wave, and the map's ending.
