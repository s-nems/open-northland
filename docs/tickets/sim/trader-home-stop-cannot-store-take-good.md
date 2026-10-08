# Set down a take good the home stop cannot store in one pass

**Area:** sim · **Priority:** P3

A trader whose home stop has no shelf for the agreement's take good (a mint trading coins for potions
with a market, as the WIELKA INWAZJA save that found this did) brings the load home and
`decidePreparation` unloads it as a stray good with no store: `unloadCart` puts each unit onto the heap
at the trader's feet, and once that tile's stack cap is reached the unit stays in its hands, the
planner's carry rung walks it to the nearest store and the trader comes back for the next one. On the
save a cart of 18 potions took about 600 ticks per unit after the first six, while the same cart was
sold at the partner's house at about 33 ticks per unit.

## Scope

- At a home stop that stores none of the cargo, set the whole stray load down beside the cart in one
  pass (`dropCarriedLoad` scatters over the nearest open nodes) instead of one unit per foot trip, so
  the settlement's carriers take it from there.
- Keep the stop-and-store path for a home stop that does store the good. The original's handling of a
  home house that cannot store the take good is unread; name the choice an approximation.

## Verify

- Sim test: a route whose home stop stores no take good empties the cart at the door within one
  unload pass, and no unit leaves on foot to a far store.
- `npm test`, `npm run check`, `npm run build`.
