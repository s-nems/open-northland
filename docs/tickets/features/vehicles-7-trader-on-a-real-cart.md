# Put the trader on an attached cart instead of an intrinsic one

**Area:** sim, app · **Focus:** `packages/sim/src/systems/trade`, `packages/app/src/hud/details-panel` · **Priority:** P2

`TradeRoute.cargo` gives every trader an invisible 15-slot cart (`TRADE_CART_SLOTS`), so a trader
can never be separated from it, an ox cart cannot be used, and no cart is ever built. In the
original the trader is the commander of a handcart or ox cart, moves the cart to within 5 hex
steps of the house through a move point found within radius 20, and detaches when none exists;
the trade tabs of the vehicle window exist only for carts
([VEHICLES.md](../../formats/VEHICLES.md#crew), [MISSIONS.md](../../formats/MISSIONS.md)).

## Scope

- Delete `cargo` from `TradeRoute`; `cartLoad` / `cartUnload` operate on the attached vehicle's
  `VehicleStock` through `modifyVehicleStock`, the one hold model; a trader without a commanded cart idles with the `noVehicleForWork` message (the original's
  exact idle behaviour is open; name the approximation).
- `MoveVehicleNearHouse`: before loading at a stop, the trader moves the cart to a node within 5
  steps of the house (search radius 20) and detaches when no node exists.
- The trader's walk clip already follows the seat: the renderer plays the cart gait for a settler a
  vehicle's `passengers` names and the carrier's walk otherwise, and the cart draws its own sprite.
  A rider inside has no `Position` and is not drawn (`Rider`, `boardRider` in
  `systems/vehicles/crew.ts`); the trader commands the cart from inside, so the cart's goto
  (`moveVehicle`, held under `waitsForHuman` until the crew boards) is what moves the pair.
- Details panel: the Handel section shows the attached cart with its load; the vehicle window's
  trade tabs (select trade house, select trader, detach trader) map to the existing trade commands.
- Update `?scene=trade` to spawn a handcart and attach the trader through `attachToVehicle`
  (`?scene=vehicles` already does that for its trader); update the trade section of
  MISSIONS.md and delete the intrinsic-cart approximation note. Save format bump.

## Verify

Existing `trade-route` tests pass on the attached cart; new tests for the near-house move, detach
on no move point, and idle without a cart. Browser check of the trade scene and the vehicle window.
`npm test`, `npm run check`, `npm run build`.
