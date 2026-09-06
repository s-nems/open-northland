# Show which tribe a building belongs to

**Area:** app · **Focus:** hud/details-panel · **Priority:** P3

A seat can field several tribes at once (`gringo_sub` seat 0 owns 109 frank, 56 byzantine, 51
weresnake and 32 saracen settlers), and tribe partitions the economy: `Building.tribe` must equal
`Settler.tribe` for a post, a home, a delivery or a farming assignment. The settler line now names
the civilization, and a tribe draws its own bodies for the jobs it authors a record for, so a
settler's tribe is usually readable - the weresnake and the werewolf author a soldier only, and
their other jobs still wear the base tribe's body. A building's tribe is not readable at all: `BuildingPanelModel.tribe` carries the localized name but no layout renders it,
and the panel shows no owner row either, so the general window needs a slot of its own.

## Scope

- Render the selected building's civilization in the details panel's general window.
- Keep the existing name column from overflowing; the tribe names are short but the window is fixed.

## Verify

Details-panel model tests over a mixed-tribe world, plus a human pass on `?map=gringo_sub&player=0`:
select buildings of two different tribes and confirm the panel says which civilization each belongs
to.
