# Check whether the original's settler panel shows an age for adults

**Area:** packages/app · **Origin:** gameplay review of fix/child-growup-time, 2026-07-20 · **Priority:** P3
**Needs user:** yes — the answer is an observation of the running original, which an agent cannot make.

The details panel appends an age to a settler's meta line only while that settler carries an `Age`
component (`packages/app/src/hud/details-panel/model/index.ts`). Since `growthSystem` removes `Age` at
adulthood, a player watching one settler sees the age climb to 11 and then the line disappear entirely.

That may be wrong. The user's own measurement of the original was phrased in settler ages ("they become
adults at 12 years"), which implies the original's panel displays an age — and if it displays one for
adults too, ours silently stops at the moment theirs would keep counting.

## Scope

First observe: in the original, select an adult settler and check whether the panel shows an age, and
whether it keeps rising past 12 (and if so, whether anything happens at an old age — death, retirement).

Only if it does show one: adults currently carry no age state at all, and `Age` is deliberately the
"is a minor" marker across at least seven call sites (`households.ts` `isMinor`, `eligibility.ts`,
`orders/work.ts` ×3, `needs.ts`, and the panel itself). Keeping `Age` on adults would silently reclassify
every adult as a child at all of them, so this needs an explicit `isMinor` predicate threaded through
first, and only then a birth-tick or lifetime-ticks field that survives graduation.

If the original shows no adult age, close this ticket — current behavior is already right.

## Verify

`npm test`, `npm run check`, `npm run build`. If adult ages land, the seven `world.has(e, Age)` sites above
each need a test that an adult is not treated as a minor. Human sign-off on the panel against the original.
