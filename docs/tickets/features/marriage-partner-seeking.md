# Implement marriage — the "Find partner" order and the family model

**Area:** sim, app · **Origin:** user report on `?map=specjalna_forteca`, fix/regression-fixes 2026-07-16 · **Priority:** P2

The user selected a woman and clicked "Find partner" ("Szukaj partnera") — nothing happened. That is
current design, not a regression: every action-ring button except change-profession and the scout's
erect-signpost is an inert `placeholder` (`packages/app/src/hud/action-ring-menu.ts`, consumed but
no-op in `view/unit-controls/settler-actions.ts`), and the sim has no marriage/family model at all.
Reproduction today is the named approximation in
`packages/sim/src/systems/lifecycle/reproduction.ts`: one birth per tribe per tick while
`tribePopulation < housingCapacity`, no couples involved. The button already carries the original's
icon binding (frame 0x68 `order_marry`) and the i18n label (`en-game.ts` key `marry`).

Source basis to pin during execution: observed original behavior — in Cultures/8th Wonder a woman is
ordered to seek a husband, pairs with a free man, the couple moves into a home, and children come
from married couples living in a house. Verify the exact original flow (who can be ordered, what
"free" means, whether a home must exist first) against the running original and the readable `.ini`
job/age-class data before coding; unknowns become investigate-first items, not guesses.

## Scope

- Sim: a `seekPartner` command + partner-matching mechanic (eligibility by sex/age-class/unmarried,
  deterministic canonical pick), a marriage state on the couple, and the walk-to-partner/wedding
  flow. Wire reproduction to married couples housed in a home, replacing (or gating) the
  housing-ceiling approximation — keep the change golden-intentional and named.
- App: make the `marry` action-ring button live (order flows like the existing `assignBuilder` /
  erect-signpost paths), hide or disable it for ineligible settlers (already-married, wrong
  age-class), and surface the spouse in the details panel.
- Acceptance scene with a headless check (a pair marries; a birth follows only for a housed couple)
  plus a human browser pass.

## Verify

`npm test`, `npm run check`, `npm run build`; new scene registered in `packages/app/src/scenes/`
with its headless assertion; human validates the flow in the browser (order → walk → wedding →
child) on the scene and on a real map (`?map=specjalna_forteca`).
