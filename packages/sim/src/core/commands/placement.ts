import type { Entity } from '../../ecs/world.js';

/** Commands that place or remove world fixtures, stores, resources, and loose goods. */
export type PlacementCommand =
  | {
      /**
       * Place a {@link Building} of `buildingType` at (x,y) for `tribe`. By default the building is fully built
       * (`built = ONE`). When `underConstruction` is set it instead enters at `built = 0`: the
       * ConstructionSystem advances it to built once its `construction` material cost is delivered into its own
       * stockpile. A type with an empty `construction` cost (the headquarters, a free type) finishes on the
       * first construction tick.
       */
      readonly kind: 'placeBuilding';
      readonly buildingType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
      /** Start the building at `built = 0` (under construction) rather than already built. Omit (the default)
       *  for an immediately-built placement. */
      readonly underConstruction?: boolean;
      /** The player that owns this building (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). Omit (or an
       *  out-of-range value) for a neutral/unowned building. Orthogonal to `tribe` (the civilization). */
      readonly owner?: number;
      /** Skip the tech + ground-collision gates and place as-is. For map-authored imports (a decoded map's
       *  `sethouse` records) and pinned demo fixtures: the original loads a map's houses verbatim, never
       *  re-validating them against the interactive placement rule. A player-issued placement must not set
       *  this — the UI goes through the gated path. */
      readonly force?: boolean;
    }
  | {
      /**
       * Place a boat hull of `vehicleType` at (x,y) for `tribe` — a ship put on the map as a mobile store (the
       * boat analogue of `placeBuilding`): it creates a {@link Vehicle} hull carrying an (empty)
       * {@link Stockpile} whose capacity is the ship type's `stockSlots`. Gated by the tribe's ship-unlock tech
       * graph (`tribeShipsUnlocked`): a hull is placed only if `vehicleType` is a ship the tribe has currently
       * unlocked (a `vehicle_ship` row whose `jobEnablesVehicle` edge is satisfied), so a cart, a catapult, or a
       * not-yet-unlocked ship is recoverable bad input — skipped, still logged. Loading cargo onto the hold (the
       * `cargoGoods` filter) and embark/disembark are deferred follow-ups.
       */
      readonly kind: 'placeBoat';
      readonly vehicleType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
      /** The player that owns this boat (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). Omit (or an
       *  out-of-range value) for a neutral/unowned hull. Orthogonal to `tribe` (the civilization). */
      readonly owner?: number;
    }
  | {
      /**
       * Place a resource node of `good` at (x,y) — the runtime analogue of the scene-setup `place*` helpers (a
       * tree / a mined deposit / a plucked node), through the one mutation seam so a node dropped while the sim
       * runs (a map/scenario editor, the debug spawn palette) stays replay-faithful and lockstep-safe, unlike
       * the direct-`world` setup path that is only sound before tick 0. The node's balance is caller-resolved:
       * `remaining` is its starting yield and `harvestAtomic` the atomic a gatherer runs on it. `felling` makes
       * it a chop-it-down tree ({@link Felling}); `deposit` makes it a mined finite deposit ({@link MineDeposit},
       * its `initial` = `remaining`); neither makes it a pluck-whole node (a mushroom). The footprint is stamped
       * from `good`'s content record; a `good` with none is bad input — skipped, still logged.
       */
      readonly kind: 'placeResource';
      readonly good: number;
      readonly x: number;
      readonly y: number;
      /** The node's starting yield (its {@link Resource.remaining}). */
      readonly remaining: number;
      /** The atomic a gatherer runs to harvest this node ({@link Resource.harvestAtomic}). */
      readonly harvestAtomic: number;
      /** A felled node (a tree): its chops-to-fell counter (stamps {@link Felling}). Mutually exclusive with
       *  `deposit`; omit both for a pluck-whole node (a mushroom). */
      readonly felling?: { readonly chopsLeft: number };
      /** A mined finite deposit (stone/clay/iron/gold): its level ladder (stamps {@link MineDeposit},
       *  `initial` = `remaining`). Mutually exclusive with `felling`. */
      readonly deposit?: { readonly levels: number };
    }
  | {
      /**
       * Drop a loose good pile on the ground at (x,y) — the "put this good here" order. It creates the same
       * on-the-ground shape a felled trunk / chipped ore takes (a bare {@link Stockpile} + Position +
       * {@link GroundDrop} of `amount` × `good`), so the existing pickup / porter / delivery machinery hauls it
       * off unchanged. Distinct from `placeResource`, which plants a standing harvestable node; this drops the
       * finished good itself. Skipped (still logged) for a `good` absent from the content catalog or an
       * `amount <= 0`. Coordinates are half-cell node coords like every command.
       */
      readonly kind: 'dropGood';
      readonly good: number;
      readonly x: number;
      readonly y: number;
      readonly amount: number;
    }
  | { readonly kind: 'demolish'; readonly building: Entity }
  /** Tear down a standing signpost (the original's "Tear down this signpost" — miscwindow 273). Instant
   *  and free like erecting; skipped for a non-signpost target. */
  | { readonly kind: 'demolishSignpost'; readonly signpost: Entity };
