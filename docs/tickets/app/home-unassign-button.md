# Add a "remove from home" action (command + details-panel button)

**Area:** app + sim command · **Origin:** user feedback 2026-07-18 · **Priority:** P2

There is `assignHouse` (`core/commands/unit-orders.ts`) but no way for the player to take a settler
OUT of a home — a mis-assigned or leftover resident occupies a family slot forever. User request:
a button to remove a settler from their home.

Scope: an `unassignHouse` sim command (drop the settler's `Residence`; decide and pin what happens
to the spouse/child of the same family — the family moves out together or the command targets the
family, not the individual), added to the fuzz generator's command variants in the same commit, plus
the player-facing button — the settler details panel (`hud/details-panel/`) and/or the home's
building panel family list — issuing it for the selection. Localized label, and the AI must not need
it (its workforce module never assigns homes).

## Verify

- Sim unit test for the command (slot frees, `assignHouse` can refill); fuzz generator covers it;
  a details-panel model test shows the button for a housed settler; `npm test`, `npm run check`,
  `npm run build`; human browser pass for the button placement.
