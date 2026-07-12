# Let buildings take combat damage and be destroyed

**Area:** sim · **Origin:** combat plan reconciliation, 2026-07-12

Only the `damageVsBuilding` read view exists (`packages/sim/src/systems/readviews/combat.ts`, the
HOUSE material column) — no conflict system calls it. `Building` carries `Health` only for
construction (`systems/economy/construction.ts`); there is no combat damage, no
destruction-on-0-HP, no order to attack a building.

**Source basis (extracted):** damage-vs-building = material-7 (HOUSE) column of the weapons.ini
damage table. Building hit-points are NOT readable (encrypted housetypes.cif) → a named
approximated constant, calibration-pending. Whether units auto-attack buildings is unreadable →
log the choice.

## Scope

- Combat `Health` on buildings + ordered building damage via the HOUSE column + destruction that
  reuses the demolish/footprint teardown seam.
- Building targeting joins the existing ring search — no new full-world scans (golden rule 6).

Garrisons and defence mode are the follow-up: [tower-defence-mode](tower-defence-mode.md).

## Verify

- `npm test` — existing goldens byte-identical (additive mechanic).
- Headless: a scripted attacker levels a building; teardown leaves no orphaned footprint/blocking.
