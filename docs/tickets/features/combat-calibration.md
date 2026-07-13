# Calibrate combat constants against the running original (interactive session)

**Area:** sim (data swaps) · **Origin:** combat plan reconciliation, 2026-07-12 · **Priority:** P2
**Needs user:** human-oracle session against the running original — not autonomously runnable.
**Blocked by:** docs/tickets/features/barracks-recruitment.md
**Blocked by:** docs/tickets/features/barracks-training.md
**Blocked by:** docs/tickets/features/building-combat-damage.md
**Blocked by:** docs/tickets/features/tower-defence-mode.md
**Blocked by:** docs/tickets/features/combat-hp-bars.md

Every approximated combat constant is greppable in code (`calibration`/`APPROXIMAT` across
`components/combat.ts`, `core/commands.ts`, `systems/conflict/*`, `systems/progression/`). This
session swaps them for observed values — the user runs the original (`../Cultures 8th Wonder`)
side by side and answers probes.

**The unreadable set (why observation is the only source):** human base HP / stamina pool / sight
radius / run speed; the XP→level curve and per-level bonuses; the exact role of `blockingValue`
and hit-vs-miss; heal/potion/amulet magnitudes; building hit-points; projectile and blood sprites;
defence-mode cadence; the HP-bar visibility rule.

## Scope

- Build the probe list from every `calibration`/`APPROXIMATED` combat item; observe the original;
  swap named constants to observed values; note "faithful (observed <date>)" at each swap site.
- Re-run the combat scenes side by side after each cluster.

## Verify

- `npm test` (goldens move intentionally — data change, name it in the commit).
- The user confirms the battle scene feels like the original.
