import type { Entity } from '../../ecs/world.js';

/** Commands that place or remove world fixtures, stores, resources, and loose goods. Coordinates are
 *  half-cell nodes. */
export type PlacementCommand =
  | PlaceBuildingCommand
  | PlaceBoatCommand
  | PlaceResourceCommand
  | DropGoodCommand
  | UpgradeBuildingCommand
  | CancelUpgradeCommand
  | DemolishCommand
  | DemolishSignpostCommand;

/** The placements a player seat may issue for itself; the rest are world edits only trusted setup or
 *  the admin channel may make. */
export type PlayerPlacementCommand =
  | PlayerPlaceBuildingCommand
  | UpgradeBuildingCommand
  | CancelUpgradeCommand
  | DemolishCommand
  | DemolishSignpostCommand;

/**
 * Place a {@link Building} of `buildingType` at (x,y) for `tribe`, fully built (`built = ONE`) unless
 * `underConstruction` is set. A type with an empty `construction` cost (the headquarters) finishes on
 * its first construction tick.
 */
interface PlaceBuildingFields {
  readonly kind: 'placeBuilding';
  readonly buildingType: number;
  readonly x: number;
  readonly y: number;
  readonly tribe: number;
  /** Start the building at `built = 0` (under construction) rather than already built. Omit (the default)
   *  for an immediately-built placement. */
  readonly underConstruction?: boolean;
  /** The player that owns this building (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). An explicit
   *  out-of-range value rejects the command; omit it for a neutral building, or in a seat envelope to
   *  own it yourself. Orthogonal to `tribe` (the civilization). */
  readonly owner?: number;
}

/** The `placeBuilding` options only trusted authored setup may set. */
interface AuthoredPlaceBuildingFields {
  /** Skip the tech + ground-collision gates and place as-is, for map-authored imports (a decoded map's
   *  `sethouse` records) and pinned demo fixtures: the original loads a map's houses verbatim, never
   *  re-validating them against the interactive placement rule. */
  readonly force?: boolean;
  /** Seed every stock slot of a fully-built placement to its capacity, for authored fixtures like a
   *  scene's pre-stocked warehouse. Ignored for an `underConstruction` site, whose hold accumulates
   *  delivered materials instead. */
  readonly fillStock?: boolean;
  /** Authored starting stock (a decoded map's `addgoods` runs after this house's `sethouse`): each
   *  entry adds `amount` × `good` on top of whatever the default/`fillStock` seeding put in the
   *  stockpile. Ignored for an `underConstruction` site, like `fillStock`. */
  readonly initialGoods?: readonly { readonly good: number; readonly amount: number }[];
}

/** A `placeBuilding` a seat issues: the authored-setup options are unrepresentable. */
export type PlayerPlaceBuildingCommand = PlaceBuildingFields & {
  readonly [K in keyof AuthoredPlaceBuildingFields]?: never;
};

/** A `placeBuilding` as the handler receives it, authored options included. */
export type PlaceBuildingCommand = PlaceBuildingFields & AuthoredPlaceBuildingFields;

/**
 * Place a boat hull of `vehicleType` at (x,y) for `tribe`: a {@link Vehicle} carrying an empty
 * {@link Stockpile} of the ship type's `stockSlots`. Gated by the tribe's ship-unlock tech graph
 * (`tribeShipsUnlocked`), so a cart, a catapult, or a not-yet-unlocked ship is skipped.
 */
export interface PlaceBoatCommand {
  readonly kind: 'placeBoat';
  readonly vehicleType: number;
  readonly x: number;
  readonly y: number;
  readonly tribe: number;
  /** The player that owns this boat (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). An explicit
   *  out-of-range value rejects the command; omit it for a neutral hull. Orthogonal to `tribe`. */
  readonly owner?: number;
}

/**
 * Place a resource node of `good` at (x,y) through the one mutation seam, so a node dropped while the
 * sim runs stays replay-faithful (the direct-`world` setup path is only sound before tick 0). The
 * footprint is stamped from `good`'s content record; a `good` with none is skipped.
 */
export interface PlaceResourceCommand {
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

/**
 * Drop a loose pile of `amount` × `good` on the ground at (x,y), in the same shape a felled trunk
 * takes, so the existing pickup and delivery machinery hauls it off unchanged. Unlike `placeResource`
 * this drops the finished good rather than planting a harvestable node. Skipped for a `good` absent
 * from the content catalog or an `amount <= 0`.
 */
export interface DropGoodCommand {
  readonly kind: 'dropGood';
  readonly good: number;
  readonly x: number;
  readonly y: number;
  readonly amount: number;
}

/**
 * Begin upgrading a built building into its type's `upgradeTarget` level. The building re-opens as a
 * construction site at the target tier's own `construction` cost: `built` drops to 0, occupants walk
 * out keeping their job/residence bindings, and its inventory is stashed so the emptied stockpile can
 * serve as the build hold. Completion adopts the target tier and restores the stash. Skipped for a
 * target that is dead, not a building, still unbuilt, already a site, of a top-level or unchained type,
 * or not tech-unlocked by the tribe.
 */
export interface UpgradeBuildingCommand {
  readonly kind: 'upgradeBuilding';
  readonly building: Entity;
}

/**
 * Abort an in-flight upgrade: the stashed inventory returns to the stockpile and the building stands
 * again at its previous level. Authored: construction materials already delivered into the site hold
 * are lost.
 */
export interface CancelUpgradeCommand {
  readonly kind: 'cancelUpgrade';
  readonly building: Entity;
}

export interface DemolishCommand {
  readonly kind: 'demolish';
  readonly building: Entity;
}

/** Tear down a standing signpost (the original's "Tear down this signpost" - miscwindow 273). Instant
 *  and free like erecting; skipped for a non-signpost target. */
export interface DemolishSignpostCommand {
  readonly kind: 'demolishSignpost';
  readonly signpost: Entity;
}
