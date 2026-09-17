# Select vehicles and expose the vehicle window and orders

**Area:** app · **Focus:** `packages/app/src/view/unit-controls`, `hud/details-panel`, `hud/action-ring` · **Priority:** P2

`click-hits.ts` and `selection-view.ts` know only settlers and buildings; the action ring's
`assignVehicle` / `attackVehicle` orders are declared inert; of the 13 mapped vehicle message ids
the refused-goto and the five crew notes have raisers (`from-events.ts`). The crew orders exist as
seat commands (`attachToVehicle`, `detachFromVehicle`, `boardVehicle`, `unloadPeople`,
`loadIntoVehicle`, `leaveCarrier`, `setVehicleWanted`, `clearVehicleWanted`) and only need buttons. The original's window and command set are listed in
[VEHICLES.md](../../formats/VEHICLES.md#lifecycle). The UI only needs to be usable; the in-game UI
rework restyles it later.

## Scope

- Picking: a vehicle is selectable by its footprint; hover tooltip with type, owner and task. The
  sprite pool already stamps bounds and a pixel hit test for `vehicle` draw items (`DrawKind`), so
  `click-hits.ts` needs the kind, not a new hit path.
- Details panel `vehicle` model, layout and sections: name and task string, hit points, commander
  and passengers (click selects the settler), carried vehicle, cargo rows with wanted `-/+`
  (10 with Shift, `setVehicleWanted`) and a clear-all button (`clearVehicleWanted`, which is also how
  the goods leave: `f` has no goods half), detach from carrier, and for carts the trade
  tabs of the trader ticket.
- Orders: go to (left-click ground), dock (ship on a shore), unload people, attack human / building /
  vehicle / position and the three stances for a catapult, stop; right-click defaults from the
  original (human -> attack human, vehicle -> load into carrier when allowed else attack, house ->
  attack, else go to). Settler ring orders `assignVehicle` (pick a vehicle) and `attackVehicle`.
- HUD messages: raise the remaining mapped ids from the sim events of the vehicle tickets, the way
  `from-events.ts` already raises `vehicleNoCommander` / `vehicleNoPath` with a `vehicle` subject.
- i18n en/pl for every new string.

## Verify

Panel model and hit-test unit tests; browser check on the vehicle scenes: select each type, set a
wanted amount, unload, attach a settler, order a catapult attack; no console errors. App gates from
`docs/TESTING.md`.
