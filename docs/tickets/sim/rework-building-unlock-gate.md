# Re-enable building unlocks as a complete player-visible rule

**Area:** sim + app · **Priority:** P1

`BUILDING_UNLOCK_GATE_ENABLED = false` makes `buildingEnabled` a no-op across placement, upgrades, job
openings, and AI targets. The extracted `jobEnablesHouse` graph is therefore unused. The gate was disabled
because the HUD showed locked buildings and upgrades as available, producing a green placement ghost
followed by a silently rejected command.

## Scope

- Pin the progression rule from extracted `jobEnablesHouse` and `needfor*` data; name any unobserved XP
  interaction as an approximation.
- Expose the same enablement in the building menu, upgrade control, and placement probe, including a
  localized explanation of the enabling trade.
- Re-enable the sim gate, unskip its tests, and update acceptance scenes so their setup is valid under
  real content. Keep the sim command guard authoritative.
- Do not add a second UI-only unlock calculation that can drift from the sim rule.

## Verify

An acceptance case starts locked, rejects no apparently-valid click, unlocks after the enabling worker
exists, and then places/upgrades/staffs successfully. Run `npm test`, `npm run check`, and `npm run build`,
plus a browser check of the menu and ghost.
