# Draw pooled world-space HP bars over damaged combatants

**Area:** render + app · **Origin:** combat plan reconciliation, 2026-07-12

The render snapshot carries no health today and `world-renderer.ts` has no HP-bar sub-layer; the
only health readout is the selected-unit gauge in the details panel (`hud/details-panel/model.ts`,
drawn through the decoded `bar_hitpoints` ramp in `app/src/content/gui-gfx.ts` `GUI_PALETTES`).

**Source basis:** the original draws one — OpenVikings `CGuiBaseDataManager` loads
`gui/palettes/bar_hitpoints.pcx`. WHEN the bar shows is unreadable → damaged-only is the named
approximation, calibration-pending (see [combat-calibration](combat-calibration.md)).

## Scope

- Thread `Health.hitpoints`/max through snapshot → scene collect → a new pooled bar layer
  (selection-layer pooling pattern; per-visible-entity, culled — render cost stays screen-bounded).
- Use the extracted `bar_hitpoints` ramp (it has landed); a two-tone quad only as the no-`content/`
  degrade path.
- Any randomness tick-seeded.

## Verify

- `npm test` — headless assertion of bar geometry / damaged-only threshold.
- `?scene=combat` + `?scene=battle`: bar tracks damage — **user's eyes for the look**.
- Render `AGENTS.md` pooling/culling gate.
