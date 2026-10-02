# Confirm need bars banking past full against the running original

Area: sim, app
Priority: P3
Needs user: observation of the running original

A need event can push a bar past 100%. Since the at-home rules, a nap at a furnished home pays its
clip's 8000 rest twice (16000), and a candy meal at home pays 12000 food. The sim stores up to half a
bar above full and clamps the rest away (`NEED_OVERFILL_UNITS`, `clampNeed` in
`packages/sim/src/systems/lifecycle/needs/scale.ts`). The settler panel clamps the gauge to 100%
(`packages/app/src/hud/details-panel/model/settler.ts`), so the banked reserve is invisible.

Original behavior, from the original's per-tick need update: every bar caps at 15000 against a
10000 maximum, so a settler may bank 150%. This is unconfirmed against the running original. A
settler fed or rested past full then goes about 13000 ticks (18 min at x1) before the 2000 drive
level, against 8000 from exactly full. That gap drives how often settlers eat and sleep.

## Outcome

- In the running original, rest a settler in a furnished home and feed one at home, then check that
  the needs window shows a full bar and that the next meal or nap comes after the banked time, not
  after a full bar's time.
- If the original caps at 100%, set `NEED_OVERFILL_UNITS` to zero and move the goldens, naming the
  change. If it banks, keep the cap and record the observation in the `NEED_OVERFILL_UNITS` comment.
- Decide whether the settler panel shows the banked reserve, according to what the original's window
  shows.

## Verification

A sim test pinning the cap: a 16000 rest event leaves the bar at the cap. Plus a timed test from
the banked bar to the drive level that matches the observed original.
