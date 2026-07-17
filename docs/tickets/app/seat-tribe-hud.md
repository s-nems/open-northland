# Make the HUD/economy view follow the claimed seat's tribe

**Area:** app · **Origin:** map player-roster work 2026-07-17 · **Priority:** P3

The `?map=` entry now plays whichever roster seat the menu claimed (`?player=N` →
`GameViewDeps.localPlayer`), but the HUD stays viking: `game/rules.ts` pins
`PRIMARY_TRIBE`/`HUD_TRIBE` to `VIKING`, and `game-view.ts` passes `HUD_TRIBE` into the tool
panel (building menu, stats). Sitting on a saracen/byzantine seat (e.g.
`Arabskie Wyspy - wolna gra mieszana` slots 1–4) shows viking buildings and stats regardless.
The seat's tribe is already decoded — `MapScript.players[].tribeId`
(`TRIBE_TYPE_HUMAN_*`, 1 viking … 7 egypt) is in `content/maps/<id>.script.json`.

Blocked in substance by content coverage: the extracted building/job/graphics content currently
centers on the viking tribe (`game/sandbox/` and `catalog/` are viking sets), so a non-viking HUD
tribe needs the corresponding tribe content extracted/joined first — check what actually resolves
before wiring the id through.

## Scope

1. Thread the claimed seat's `tribeId` from the map script into the game view (next to
   `localPlayer`) and use it for the HUD tribe where content for that tribe resolves; fall back to
   viking (named approximation) where it does not.
2. Survey what breaks for tribes 2–7 (building menu entries, worker roles, settler graphics) and
   file follow-ups per real gap rather than one mega-ticket.

## Verify

- `npm test`, `npm run check`, `npm run build`; a browser pass on a mixed-tribe map for whatever
  slice the survey lands.
