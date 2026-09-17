import type { Paper } from '../../components/papers.js';
import type { Entity } from '../../ecs/world.js';

/** Commands that place or remove world fixtures, stores, resources, and loose goods. Coordinates are
 *  half-cell nodes. */
export type PlacementCommand =
  | PlaceBuildingCommand
  | PlaceResourceCommand
  | PlacePalisadeCommand
  | DropGoodCommand
  | UpgradeBuildingCommand
  | CancelUpgradeCommand
  | DemolishCommand
  | DemolishSignpostCommand
  | DemolishPalisadeCommand
  | ConvertPalisadeGateCommand
  | SetPalisadeGateCommand;

/** The placements a player seat may issue for itself; the rest are world edits only trusted setup or
 *  the admin channel may make. */
export type PlayerPlacementCommand =
  | PlayerPlaceBuildingCommand
  | PlacePalisadeCommand
  | UpgradeBuildingCommand
  | CancelUpgradeCommand
  | DemolishCommand
  | DemolishSignpostCommand
  | DemolishPalisadeCommand
  | ConvertPalisadeGateCommand
  | SetPalisadeGateCommand;

/** Place one data-described wall segment at a half-cell node. `gfxIndex` selects the map catalog row,
 * which must carry `ScriptLandscapeType.wall`; seat envelopes own the segment and start it unfinished. */
export interface PlacePalisadeCommand {
  readonly kind: 'placePalisade';
  readonly gfxIndex: number;
  readonly x: number;
  readonly y: number;
  readonly tribe: number;
  readonly owner?: number;
  /** Trusted map setup may place an already-standing neutral or owned wall. */
  readonly underConstruction?: boolean;
  /** Trusted authored-map durability/valency; ignored for a construction site. */
  readonly valency?: number;
  readonly force?: boolean;
}

export interface DemolishPalisadeCommand {
  readonly kind: 'demolishPalisade';
  readonly palisade: Entity;
}

export interface SetPalisadeGateCommand {
  readonly kind: 'setPalisadeGate';
  readonly palisade: Entity;
  readonly open: boolean;
}

/** Cut a completed closed gate into the centre of a qualifying five-wall span, clearing its two
 * neighbours and leaving the outer pair standing. */
export interface ConvertPalisadeGateCommand {
  readonly kind: 'convertPalisadeGate';
  readonly palisade: Entity;
  readonly gfxIndex: number;
}

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
  /** Seat placements default to true; only trusted origins may request false. */
  readonly underConstruction?: boolean;
  /** The player that owns this building (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). An explicit
   *  out-of-range value rejects the command; omit it for a neutral building, or in a seat envelope to
   *  own it yourself. Orthogonal to `tribe` (the civilization). */
  readonly owner?: number;
  /**
   * Spend one of the owner's placing papers on this placement: the building stands finished at once,
   * and a `placeStockedHouse` paper also fills every stock slot to capacity. The paper must be a placing
   * kind the owner holds, and a house paper must name `buildingType`; otherwise nothing is placed and
   * nothing is spent. A house paper bypasses the tech gate, as the original's paper window lists the
   * named house whether or not the tribe has unlocked it.
   */
  readonly paper?: Paper;
}

/** The `placeBuilding` options only trusted authored setup may set. */
interface AuthoredPlaceBuildingFields {
  /** Skip the tech + ground-collision gates and place as-is, for map-authored imports (a decoded map's
   *  `sethouse` records): the original loads a map's houses verbatim, never re-validating them against
   *  the interactive placement rule. */
  readonly force?: boolean;
  /** Seed every stock slot of a fully-built placement to its capacity. Ignored for an `underConstruction`
   *  site, whose hold accumulates delivered materials instead. */
  readonly fillStock?: boolean;
  /** Authored starting stock (a decoded map's `addgoods`): each entry adds `amount` × `good` on top of
   *  whatever the default/`fillStock` seeding put in the stockpile. Ignored for an `underConstruction`
   *  site, like `fillStock`. */
  readonly initialGoods?: readonly { readonly good: number; readonly amount: number }[];
  /** The {@link import('../../components/mission.js').MissionObjectId} to stamp; omit for a house no
   *  mission addresses. */
  readonly missionId?: number;
}

/** A `placeBuilding` a seat issues: the authored-setup options are unrepresentable. */
export type PlayerPlaceBuildingCommand = PlaceBuildingFields & {
  readonly [K in keyof AuthoredPlaceBuildingFields]?: never;
};

/** A `placeBuilding` as the handler receives it, authored options included. */
export type PlaceBuildingCommand = PlaceBuildingFields & AuthoredPlaceBuildingFields;

/**
 * Place a resource node of `good` at (x,y) through the one mutation seam, so a node dropped while the
 * sim runs stays replay-faithful. The footprint is stamped from `good`'s content record; a `good` with
 * none is skipped.
 */
export interface PlaceResourceCommand {
  readonly landscapeId?: number;
  readonly kind: 'placeResource';
  readonly good: number;
  readonly x: number;
  readonly y: number;
  /** The node's starting yield (its {@link Resource.remaining}). */
  readonly remaining: number;
  /** The atomic a gatherer runs to harvest this node ({@link Resource.harvestAtomic}). */
  readonly harvestAtomic: number;
  /** A felled node (a tree) when true (stamps {@link Felling}). Mutually exclusive with `deposit`; omit
   *  both for a pluck-whole node (a mushroom). */
  readonly felling?: boolean;
  /** A mined finite deposit (stone/clay/iron/gold): its level ladder (stamps {@link MineDeposit},
   *  `initial` = `remaining`). Mutually exclusive with `felling`. */
  readonly deposit?: { readonly levels: number };
}

/**
 * Drop a loose pile of `amount` × `good` on the ground at (x,y), in the same shape a felled trunk
 * takes, so the existing pickup and delivery machinery hauls it off unchanged. Skipped for a `good`
 * absent from the content catalog or an `amount <= 0`.
 */
export interface DropGoodCommand {
  readonly kind: 'dropGood';
  readonly good: number;
  readonly x: number;
  readonly y: number;
  readonly amount: number;
}

/**
 * Begin upgrading a built building into its type's `upgradeTarget` level: it re-opens as a construction
 * site at the target tier's own `construction` cost, keeping its occupants' job and residence bindings,
 * and completion adopts that tier. Skipped for a target that is dead, not a building, still unbuilt,
 * already a site, of a top-level or unchained type, or not tech-unlocked by the tribe.
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
