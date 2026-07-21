# Calibrate combat constants against the running original (interactive session)

**Area:** sim (data swaps) · **Priority:** P2
**Needs user:** a live comparison with the running original, so this is not autonomously runnable.
**Blocked by:** [barracks recruitment](barracks-recruitment.md),
[barracks training](barracks-training.md), and [tower defence](tower-defence-mode.md)

Every approximated combat constant is greppable in code (`calibration`/`APPROXIMAT` across
`components/combat.ts`, `core/commands.ts`, `systems/conflict/*`, `systems/progression/`). This
session swaps them for observed values while the user runs the original (`../Cultures 8th Wonder`)
side by side and answers probes.

**The unreadable set (why observation is the only source):** human base HP / stamina pool / sight
radius; the XP→level curve and per-level bonuses; the exact role of `blockingValue`
and hit-vs-miss; heal/potion/amulet magnitudes; building hit-points; projectile and blood sprites;
and defence-mode cadence.

## Scope

- Build the probe list from every `calibration`/`APPROXIMATED` combat item; observe the original;
  swap named constants to observed values; note "faithful (observed <date>)" at each swap site.
- Re-run the combat scenes side by side after each cluster.

## Verify

- `npm test` (goldens move intentionally for this data change; name it in the commit).
- The user confirms the battle scene feels like the original.
