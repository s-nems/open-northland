# Finish the settler panel's deferred affordances

**Area:** app, sim · **Focus:** in-game UI redesign · **Priority:** P3

The DOM settler panel (`packages/app/src/hud/dom/settler-panel/`) lacks two affordances.

## Scope

- **Knowledge link.** The upcoming-unlock rows (`settler-panel/experience.ts`) show a lock and a
  tooltip but lead nowhere. Open the unlocked good's or trade's Knowledge entry from the row, as the
  building panel's `knowledge` order does (`view/unit-controls/panels/chrome.ts`).
- **Wear minutes.** A worn item's socket tooltip (`settler-panel/equipment.ts`) gives the life left as
  a percent only. Add the minutes it buys at the wearer's current pace, which needs a sim read seam for
  the wear an item takes per game minute of its wearer's current work; add it only if it is cheap for
  the one selected settler.

## Verify

Unit-test the Knowledge link opening the right entry and the wear estimate against a known pace.
Check a locked product and a worn tool in the running game, and provide the verified preview.
