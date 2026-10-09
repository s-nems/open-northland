# Finish a multiplayer goal verdict: loser teardown, ranking and progress lines

**Area:** sim, app · **Focus:** `packages/sim/src/systems/match/goals.ts` · **Priority:** P3

`[misc_multiplayer_goals]` now decides players on multiplayer maps, but three parts of the original's
check are not ported ("Multiplayer goals" in `docs/formats/MISSIONS.md`):

- a player that lost has every house, human, vehicle and signpost removed on the next check and its
  animals turned wild; here the loser's world stays;
- each verdict is numbered in the order it lands and the end-of-game ranking sorts by it; here the
  end-of-match panel has no order;
- the goods and inhabitants rows show `have/need` progress in the on-screen info lines.

## Scope

- Remove a loser's entities through the existing removal seams on the check after its verdict (a
  script removal, not deaths in the tallies), turning its animals wild.
- Store the verdict order in the saved `MatchGoals` state and sort the end-of-match panel by it.
- Feed the goods and inhabitants progress into the info-line model, counted on the goal check rather
  than per frame.

## Verify

- Sim tests: teardown on the check after the verdict, never on the verdict's own check; ranking order
  across save/load; no per-tick cost outside the 120-tick check.
- Two-client relay run on a corpus multiplayer map: both peers agree on teardown and ranking.
- Normal gates plus `npm run test:content`.
