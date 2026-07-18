# Upgrade/Cancel button: wire the decoded description tooltips

**Area:** app/HUD · **Origin:** building-upgrades merge review, 2026-07-18 · **Priority:** P3

The Upgrade button's **cost preview** is done: hovering it now shows "Upgrade requires:" + the
difference bill (`upgradeTierOf(type).construction`) via the shared HUD tooltip seam
(`hud/details-panel/panel.ts` `upgradeButtonHint`, model `BuildingPanelModel.upgradeCost`).

Remaining: wire the decoded `housewindow` strings as the buttons' *descriptive* hover tooltips —
111 "Rozpocznij ulepszanie budynku" (start-upgrade) on the Upgrade button and 113 "Zatrzymaj
ulepszanie budynku" (stop/cancel) on the Cancel-upgrade button — from
`content/gui/strings/<lang>.json`. The Cancel button currently has no hover text at all; cancelling
forfeits already-delivered materials, so its description carries real weight (mitigated: cancelling
before any delivery costs nothing).

Scope: extend the button hover-hint probe (`hud/details-panel/sections/building/general.ts` +
`layout/building.ts` supply the button rects; `panel.ts` dispatches the tooltip) to return string
111 for `upgrade` and 113 for `cancelUpgrade`, resolved through the decoded `uiString` table with an
English catalog fallback. Decide whether the Upgrade button's description text and its cost lines
coexist in one tooltip or the cost preview stays as-is — the decoded string pins the description
text; combining it with the bill is a presentation choice, name it if approximated.
