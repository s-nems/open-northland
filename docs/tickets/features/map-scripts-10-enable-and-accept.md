# Enable mission scripts by default and accept them on a real map

**Area:** sim, app · **Focus:** acceptance · **Priority:** P2
**Blocked by:** [map-scripts-8-tributes.md](map-scripts-8-tributes.md)

Map-scripts epic, stage 10 of 10. Also needs stages 7 and 9 merged; check the coverage report
before starting.

With the executors in place, `MissionRules` still defaults to off and only `?missions=on` turns a
script on, so players never see one run. This stage flips the default, proves a campaign map end to
end, and records what the original confirms.

## Scope

- Flip the `MissionRules` default to on; keep the flag and the `?missions=` override for tests.
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
