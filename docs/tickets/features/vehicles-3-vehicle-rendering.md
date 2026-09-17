# Draw vehicles with the original cart, catapult and ship sprites

**Area:** render, app · **Focus:** `packages/render/src/data/scene`, `packages/app/src/content` · **Priority:** P2
**Blocked by:** [entity](vehicles-2-vehicle-entity.md)

`DrawKind` has no vehicle member; `snapshot-readers/classify.ts` lets a `Vehicle` entity fall
through to `stockpile`, so a boat draws as a goods heap. The atlases are already baked
(`content/bobs/cr_veh_body_00.*`, `ls_vehicles.human_ship01.*`) but nothing binds them. Graphics
facts in [VEHICLES.md](../../formats/VEHICLES.md#graphics).

## Scope

- Add `vehicle` to `DrawKind`, classify by the `Vehicle` component, assemble one draw item per
  vehicle with facing, task and load state, and a fog ghost like buildings.
- Bind sprites from the IR's `vehicleGraphics` rows (one per tribe and type: body atlas, palette,
  `clips` per action and `gaits` per hauled good, all as bob ids): handcart wait, bullcart wait/walk
  with the oxcart palette for type 2 and the empty wait for type 6, catapult drive/attack, ship
  idle/move/dock frames with the player palette from `playerPalettes` (only the `human_ship01`
  atlas is baked today). Fall back where the shipped data has holes, listed under
  [graphics](../../formats/VEHICLES.md#graphics): Egypt has no rows, the Viking big ship's loaded
  hull has no frames, and several carts have a wait but no drive. Use the trader's existing
  `human_man_z00Trader_walk` gait only while a trader is attached; a lone trader walks like a
  carrier.
- Interpolate position and facing between ticks like settlers; a moving cart shows the loaded
  goods variant when its stock is non-empty (approximation: the original's load variants are
  palette rows, not per-good art).
- Catapult attack clip 48 ticks with the smoke effect through the existing craft-effect item.

## Verify

Render snapshot tests for each type and facing; the `?scene=vehicles` acceptance scene from the
entity ticket shows every type; browser check that no vehicle draws as a heap; render and app
gates from `docs/TESTING.md`.
