# Upgrade button: decoded tooltips + cost preview before commit

**Area:** app/HUD · **Origin:** building-upgrades merge review, 2026-07-18 · **Priority:** P3

The details panel's Upgrade/Cancel button (`hud/details-panel/sections/building/general.ts` +
`layout/building.ts`) shows no tooltip and no cost: the decoded `housewindow` strings are extracted
but unwired — 111 "Rozpocznij ulepszanie budynku" (start) and 113 "Zatrzymaj ulepszanie budynku"
(cancel state) in `content/gui/strings/<lang>.json` — and the upgrade's difference bill only appears
AFTER clicking, once the construction window swaps in. Cancelling forfeits already-delivered
materials, so an uninformed click has a real price (mitigated: cancelling before any delivery costs
nothing).

Scope: wire strings 111/113 as the button's hover tooltip (the shared HUD tooltip seam), and show
the upgrade difference bill before commit — in the tooltip or beside the button (the bill is
`upgradeTierOf(type).construction`, already the sim's `constructionBillOf` upgrade branch). Source
basis: the decoded string table pins the texts; where the original displays the cost pre-click is
unobserved — observe or name the placement as an approximation.
