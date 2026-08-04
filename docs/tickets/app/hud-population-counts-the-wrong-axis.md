# The HUD counts a tribe while the player commands a seat

**Area:** app, render · **Priority:** P2

`buildHud` (`packages/render/src/data/hud/model.ts`) sums population and jobs for one `tribe`, and the app
passes `HUD_TRIBE`, pinned to `PRIMARY_TRIBE` = viking (`packages/app/src/game/rules.ts:13`). A player
commands a *seat*, and a decoded seat is routinely multi-tribe:

- `gringo_sub.json` seat 0, the human seat, fields byzantine, frank, saracen and weresnake - and **no
  vikings**, so the readout is 0 while the player has 248 units;
- `mroczny_las.json` seat 3 fields 321 vikings, 174 saracens and 103 werewolves, so the readout shows
  barely half the army.

Stocks have the same split: the panel sums stores by `Building.tribe`, not by owner.

## Scope

- Key the HUD aggregates on the owning player, not the tribe id, and decide what the tribe line means
  once population no longer implies one tribe.
- `HUD_TRIBE` disappears with it; `packages/app/src/entries/shot.ts` is the other caller.

## Verify

- `packages/render/test/hud.test.ts` gains a multi-tribe seat case.
- `npm run check`, `npm run build`, `npm test`.
- Player-visible: open `gringo_sub` as seat 0 and confirm the population line matches the army on screen.
