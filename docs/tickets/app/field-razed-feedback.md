# Signal the crops a building site will destroy

**Area:** app + render · **Priority:** P2
**Needs user:** observe whether the original destroys, keeps, or warns about wheat under a new building.

A field declares no build area, so a building site over standing wheat is accepted like any other. The
plants under the new walls are then destroyed (`destroyFieldsUnderBuilding`,
`packages/sim/src/systems/economy/farming.ts`). That is the intended mechanic — but nothing tells the
player it happened:

- `destroyFieldsUnderBuilding` emits no event, unlike its sibling `destroyBerryBushesInReserved`, which
  emits `berryBushRazed` (`packages/sim/src/systems/economy/berries.ts`).
- The build ghost (`packages/app/src/view/placement-overlay.ts`) is binary allowed/refused, so a plot node
  reads plain green — identical to bare grass.
- There is no confirmation and no undo.

Sowing a field is farmer labor the player paid for, and this is the one thing on the map a player's own
build click destroys silently.

## Scope

- Emit a `fieldRazed` event from `destroyFieldsUnderBuilding` so render/audio can hook it (mirror
  `berryBushRazed`'s shape).
- Mark the fields a candidate site would take in the build ghost, so the cost is visible BEFORE the click.

## Source basis

What the original does here is not established. `landscapetypes.ini` and `landscapeGfx 864` prove only that
it does not REFUSE the site; whether the plants vanish, survive under the building, or survive and stay
harvestable, and whether any sound or message fires, needs an observation pass on the owned copy. If the
original is silently destructive, a quiet ghost highlight is faithful and a confirmation dialog is not.

## Verify

- Placing a building over a plot emits one `fieldRazed` per destroyed field.
- The build ghost distinguishes a site that would take crops from one that would not.
- No registered acceptance scene covers building over farmland today; add one with this work.
