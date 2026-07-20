# The golden slice never crosses a need threshold, so needs changes move no golden

**Area:** sim · **Origin:** needs-pacing worktree, 2026-07-20 · **Priority:** P2

`test/core/golden-trace.test.ts` is the integration tripwire, and its header says the needs retune is
"baked into this hash". It isn't, in the way that matters: **no settler in the slice ever reaches the
eat or sleep trigger**, so none of the needs *drives* is covered by a golden at all.

The arithmetic, from the slice's own constants:

- starting deficits are seeded in `[0, NEED_INIT_MAX_DEFICIT_PERCENT]` = 0–50% of a bar
  (`systems/lifecycle/needs.ts` `rollInitialNeed`);
- the bar rises `1 / (80 × 10 × 12)` = 1/9600 per tick, so the slice's `TICKS = 1000` window adds
  `0.104`;
- worst case a settler ends at `0.604`, under the `¾` `HUNGER_EAT_THRESHOLD` /
  `FATIGUE_SLEEP_THRESHOLD`.

The needs *rise* is hashed (the bars are component state), but eating, foraging, sleeping, the
rest-spot walk-aside and the sleep-at-home rung are all invisible to it.

This was found the hard way: a branch that changed how much a meal and a sleep restore, deleted the
eat-duration multiplier, made sleep a walk-then-act rung and added a sleep-at-home rung moved **zero
goldens**. That reads as "safe refactor" and is really "not covered".

## Scope

- Make the integration golden reach the drives. Cheapest honest options, in preference order:
  either lengthen `TICKS` past the threshold crossing, or seed one settler in the slice with an
  authored high starting deficit. Prefer whichever keeps the trace readable.
- The atomic-action trace should then contain eat (10) and sleep (8) entries — that is the point, so
  assert it rather than leaving it implicit.
- Landing this **moves the golden hash and trace on purpose**; name the mechanic in the commit, as
  `packages/sim/AGENTS.md` requires.
- Fix the stale header claim in `golden-trace.test.ts` either way — right now it overstates what the
  hash covers, which is what made the gap easy to miss.

## Verify

- `npm test` — the golden moves once, deliberately, and holds after.
- Sanity check the new trace actually contains the needs atomics; a golden that still never fires them
  has not fixed anything.
