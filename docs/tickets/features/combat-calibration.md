# Calibrate combat constants against the running original (interactive session)

**Area:** sim (data swaps) · **Origin:** combat plan reconciliation, 2026-07-12 · **Blocked by:**
the other combat tickets (run once field combat + barracks + towers are in)

Every approximated combat constant is greppable in code (`calibration`/`APPROXIMAT` across
`components/combat.ts`, `core/commands.ts`, `systems/conflict/*`, `systems/progression/`). This
session swaps them for observed values — it is a **human-oracle session**: the user runs the
original (`../Cultures 8th Wonder`) side by side and answers probes; it cannot run autonomously.

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
