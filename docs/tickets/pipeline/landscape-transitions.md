# Play the authored falling stage of felled trees and skeletons

**Area:** pipeline, app, render · **Focus:** landscape objects · **Priority:** P2

`landscapes.cif` chains landscape records with `GfxTransition <kind> "<record>"` (497 lines), e.g.
`fir 01` → (11) `fir 01 falling` → (13) `tree trunk medium`, and `skeleton_01` → (13)
`cadaver human bones01`. The pipeline does not extract the key. As a result:

- Felling a tree removes it and drops the trunk pile at once (`Felling` in
  `packages/sim/src/components/economy/resources.ts`). The 40 `* falling` records (7-9 frames,
  `loopAnimation` false) never play.
- Maps place 181 falling trees and 10 skeletons (`skeleton_01..03`, 12 frames). `loadMapObjects`
  animates only `loopAnimation` records, so they stay frozen on frame 0.

## Scope

- Extract `GfxTransition` onto `LandscapeGfxRow` (bump `IR_VERSION`).
- When a felled tree leaves the world, the app plays its falling record's frames once at the tree's
  cell, as presentation only, before the trunk pile shows. The sim keeps its timing.
- A placed one-shot record plays once, then draws its transition target's still.
- Investigate first which kinds besides 11 and 13 matter (kind 7 points a record at itself); drop the
  unused kinds without extracting them.

## Verify

- Pipeline test for `GfxTransition` extraction, with a content test that every `* falling` record is
  reachable from its tree.
- App test: the one-shot clip resolves for a felled tree's record.
- Browser: fell a tree and watch it fall. On a map with placed falling trees (e.g. an `OrangeTree 01
  falling` placement), the tree falls once and rests as a trunk.
