# A placed building is stamped viking whatever the seat fields

**Area:** app · **Priority:** P2

`startGameView` passes `tribe: PRIMARY_TRIBE` (= viking) into the tool panel
(`packages/app/src/view/runtime/game-view.ts:158`), which hands it to the placement controller
(`packages/app/src/hud/tool-panel/placement.ts:75`) as the `placeBuilding` command's `tribe`. The
value is a constant, so every building the player raises is viking regardless of the seat's tribes.
The building menu is unfiltered too: `menuEntriesFromContent`
(`packages/app/src/view/game-tool-panel.ts:86`) lists every type in `content.buildings`.

`Building.tribe` is not cosmetic. It gates workplace matching
(`packages/sim/src/systems/settlers/targets/workplaces.ts:32`), job openings, delivery rules, the
farming drive, construction employment and family assignment. On `gringo_sub` seat 0, which fields
frank, byzantine, weresnake and saracen and no vikings, a placed building is therefore unstaffable
by the settlers that placed it.

## Scope

- The answer is already decoded: `MapPlayerSlot.tribeId` (`packages/data/src/schema/maps/script.ts:24`)
  is populated for every seat in every `content/maps/<id>.script.json`, and it is the seat's *build*
  tribe rather than a summary of its units - `mroczny_las` seat 3 is `tribeId` 1 (viking) while
  fielding saracens and werewolves, and `gringo_sub` seat 0 is 2 (frank), its largest contingent.
- Key the placement stamp and the build menu on that seat tribe instead of `PRIMARY_TRIBE`.

## Verify

- A headless case over a decoded multi-tribe seat: place a building, then confirm a settler of that
  seat can take the opening.
- `npm run check`, `npm run build`, `npm test`, and `npm run test:content`.
- Player-visible: open `gringo_sub` as seat 0, build a house, and confirm builders raise it.
