# Calibrate combat constants against the running original (interactive session)

**Area:** sim · **Focus:** data swaps · **Priority:** P2
**Needs user:** a live comparison with the running original, so this is not autonomously runnable.
**Blocked by:** [tower defence](tower-defence-mode.md)

Every approximated combat constant is greppable in code (`calibration`/`APPROXIMAT` across
`components/combat.ts`, `core/commands.ts`, `systems/conflict/*`, `systems/progression/`). This
session swaps them for observed values while the user runs the original (`../Cultures 8th Wonder`)
side by side and answers probes.

**The unreadable set (why observation is the only source):** human base HP / stamina pool / sight
radius; the child-to-adult HP ratio; the XP→level curve and per-level bonuses; the exact role of
`blockingValue` and hit-vs-miss; heal/potion/amulet magnitudes; damage dealt TO a building (its pool
is readable - `logichitpoints`, extracted for 54 of 55 types - but swings-to-raze is not); projectile
and blood sprites; the projectile `speed` unit (eye-tuned twice now, see
[projectile flight metric](../sim/projectile-flight-screen-metric.md)); and defence-mode cadence.

The child ratio has a readable neighbour worth probing against: `animaltypes.ini` pairs
`hitpoints_baby` with `hitpoints_adult` for 18 species at 0.30..1.00 (median 0.50), while our human
child sits at 300 against a 5000 adult pool (0.06). Probe: count sword swings to kill an authored
child vs an adult in the original. An observed ratio swaps into a `TribeType` field beside
`hitpoints` (the human twin of `hitpointsBaby`, which `animalBabyHitpoints` already reads), not into
the sim-side `DEFAULT_SETTLER_HITPOINTS` constant every tribe currently shares. Judge the disclosure
with it: the health bar and life heart are fractions, so a 300-HP child and a 5000-HP adult both read
full until the one fatal swing.

## Scope

- Build the probe list from every `calibration`/`APPROXIMATED` combat item; observe the original;
  swap named constants to observed values; note "faithful (observed <date>)" at each swap site.
- Re-run the combat scenes side by side after each cluster.

## Verify

- `npm test` (goldens move intentionally for this data change; name it in the commit).
- The user confirms the battle scene feels like the original.
