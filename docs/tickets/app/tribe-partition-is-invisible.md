# Show which tribe a building and a settler belong to

**Area:** app · **Focus:** hud/details-panel + i18n · **Priority:** P3

A seat can field several tribes at once (`gringo_sub` seat 0 owns 109 frank, 56 byzantine, 51
weresnake and 32 saracen settlers), and tribe partitions the economy: `Building.tribe` must equal
`Settler.tribe` for a post, a home, a delivery or a farming assignment. The player cannot see that
line anywhere. `BuildingModel.tribe` is filled (`packages/app/src/hud/details-panel/model/index.ts`)
but no layout renders it, and the settler line prints the raw code as `Tribe 3`
(`packages/app/src/i18n/catalogs/en-game.ts`, `hud.playerTribe`).

The pick modes now agree with the sim - a workplace or home of another tribe is skipped or tinted
red rather than washing green - so a refused post no longer eats the click silently. What is left is
that the player is told "no" without being told why.

## Scope

- Name tribes in the interface instead of printing the numeric code: a localized tribe name for the
  settler line, and the building's tribe on the details panel where its owner already shows.
- Both catalogs (`en-game`, `pl-game`) need the seven `TRIBE_TYPE_HUMAN_*` names.

## Verify

Details-panel model tests over a mixed-tribe world, plus a human pass on `?map=gringo_sub&player=0`:
select settlers of two different tribes and confirm the panel says which tribe each belongs to and
which tribe the building under the cursor is.
