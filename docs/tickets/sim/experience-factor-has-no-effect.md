# Make `experienceFactor` scale leveling speed as the original does

**Area:** sim, data · **Priority:** P2

`experienceFactor` currently cancels itself out, so every track levels at exactly one repeat per
counted action no matter what the data says. `accrueTrack` (`packages/sim/src/systems/progression/
experience.ts`) stores `experienceFactor * units`, and `experienceRepeats`
(`packages/sim/src/systems/progression/bonus.ts`) divides the same factor back out before the curve.

The original treats the field as a speed multiplier. Byte evidence: experience gain adds a flat
`+1` to the raw counter, and every reader (experience factor, output amount, needed work repeats)
computes the curve input as `(record.experiencefactor * rawCounter) / 100`, truncated to a multiple
of 100. The record's default `experiencefactor` is `100`, which is the rate the repository's
behaviour silently assumes for every track.

Consequence with the shipped data: the builder's general track (factor 5) should need 20 completed
works per repeat and needs 1; `soldier general` (factor 1) should need 100 hits per repeat and needs
1; `carrier general` (factor 50) should need 2 deliveries and needs 1; `collector wood` (factor 250)
and `hunter general` (factor 200) should level 2.5x and 2x faster than a factor-100 track and do not.
`requirementRepeats` divides the same factor out, so every `needfor*` gate shifts with the encoding;
which value the original compares a gate against is not yet read out and must be settled first.

## Scope

Decide one encoding for saved experience and apply it to accrual, the curve input, the requirement
readers (`requirementRepeats`, `rawXpForRepeats`), the cap, and the details-panel rows, so a repeat
costs `100 / experienceFactor` counted actions. Rewrite the encoding paragraph in
[PROGRESSION.md](../../formats/PROGRESSION.md), which currently describes the cancelling encoding as
the contract.

Settle both record defaults in the same change, since the original initializes them together:
`experienceFactor` defaults to `0` here and to `100` there (decide whether a
factor-0 track should accrue nothing), and `workRepeatsFor`
(`packages/sim/src/systems/progression/experience.ts`) falls back to `1` stroke where the record
default is `10`. Only `hunter general`, `farmer wheat` and `fisher general` state
`baserepeatcounter`, so the other 67 records take that fallback.

Changing the encoding changes saved experience values and the progression goldens, so bump
`SAVE_FORMAT_VERSION` and regenerate `packages/sim/test/fixtures/save.golden` in the same commit.

## Verify

- A unit test per shipped factor value proving the repeat cost: factor 5 needs 20 works, factor 100
  needs 1, factor 250 reaches 2 repeats on the first work.
- `needforjob`-gated profession unlocks still open at the intended action counts on real content.
- `npm test`, `npm run check`, `npm run test:content`.
