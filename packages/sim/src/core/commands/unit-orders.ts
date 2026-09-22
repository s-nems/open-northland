import type { EquipCategory, HomeQualityEffect } from '@open-northland/data';
import type { NeedKind } from '../../components/needs.js';
import type { VehicleAttackTarget, VehicleStance } from '../../components/vehicle.js';
import type { Entity } from '../../ecs/world.js';
import type { Command } from './index.js';

/** The sexes a `makeChild` order may ask for. */
export const CHILD_SEXES = ['female', 'male'] as const;

/**
 * One settler of a group order. Every group order names its settlers in `members`, which the authority
 * gate narrows to the ones the issuing seat commands.
 */
export interface GroupMember {
  readonly entity: Entity;
}

/** One member of an `assignWorkerGroup` order, with the job list a lone `assignWorker` would carry. */
export interface GroupWorker extends GroupMember {
  readonly jobPriority: readonly number[];
}

/** Commands that direct existing settlers and their work. Coordinates are half-cell nodes. */
export type UnitOrderCommand =
  | {
      /**
       * Walk one owned settler to (x,y). The economy AI reclaims the unit on arrival, and a tower
       * garrison is released from its post.
       */
      readonly kind: 'moveUnit';
      readonly entity: Entity;
      readonly x: number;
      readonly y: number;
    }
  | {
      /**
       * Walk one owned settler to (x,y) fighting what it meets on the way - the original's "Attack
       * Position" (`misclogic/48`, armed by the `misc/31` "Select attack position" prompt).
       * Approximation: the original's en-route behaviour is unobserved.
       */
      readonly kind: 'attackMoveUnit';
      readonly entity: Entity;
      readonly x: number;
      readonly y: number;
    }
  | {
      /**
       * Send one owned settler to open `chest`: it walks to the chest's work cell and plays the open-chest
       * atomic, whose effect hands the contents out - goods on the ground beside the chest, papers into
       * the owner's list, units at the chest. A wooden chest takes any adult, a magical one a druid or
       * hero; a chest gone or an ineligible settler orders nothing.
       */
      readonly kind: 'openChest';
      readonly entity: Entity;
      readonly chest: Entity;
    }
  | {
      /**
       * Change one owned settler's trade, resetting it to an unposted idle worker of that trade. The
       * civilist job (`jobtypes.ini` 6) is an ordinary assignable record no workplace employs.
       */
      readonly kind: 'setJob';
      readonly entity: Entity;
      readonly jobType: number;
    }
  | {
      /**
       * Focus one owned combatant on `target`, an enemy unit, building or vehicle, until the target
       * dies, overriding sight-radius auto-engagement. Hostility is re-validated each tick by the
       * CombatSystem, not at issue.
       */
      readonly kind: 'attackUnit';
      readonly entity: Entity;
      readonly target: Entity;
    }
  | {
      /**
       * Set one owned siege vehicle's stance (the original's 1 attack / 2 defence / 3 hold buttons):
       * `hold` fires only inside its weapon band around where it stands and never moves, `defence`
       * chases within a leash of that spot, `attack` scans around wherever it is. Setting a stance
       * re-anchors the guard position on the vehicle's current node.
       */
      readonly kind: 'setVehicleStance';
      readonly vehicle: Entity;
      readonly stance: VehicleStance;
    }
  | {
      /**
       * Aim one owned siege vehicle at `target`: an enemy unit, house or vehicle it keeps after (the
       * original's `h`, `i`, `k`), or a map point it batters (`l`). Outside the `hold` stance the
       * vehicle backs off, closes in or repositions as its weapon band demands; holding, it fires only
       * on a target already inside the band and lets any other go. A goto under way finishes first.
       * The order lapses when the target is gone. Refused with `vehicleMoveRefused` `noCommander`
       * while nobody commands it.
       */
      readonly kind: 'attackWithVehicle';
      readonly vehicle: Entity;
      readonly target: VehicleAttackTarget;
    }
  | {
      /**
       * Set one owned unit's military stance - the original's per-unit `MILITARY_MODE`. `DEFEND` captures
       * the unit's current tile as its defend anchor; an explicit `attackUnit` order overrides the mode.
       */
      readonly kind: 'setStance';
      readonly entity: Entity;
      /** The target {@link import('../../systems/readviews/stances.js').MILITARY_MODE} id (0..4). */
      readonly mode: number;
    }
  | {
      /**
       * Employ one owned settler at `building`: bind it to that workplace and set its `jobType` to the
       * open worker slot it qualifies for. The only way a settler becomes employed.
       */
      readonly kind: 'assignWorker';
      readonly entity: Entity;
      readonly building: Entity;
      /** Ordered candidate worker jobs to try (highest preference first); the first one open for this
       *  settler wins. Entries only filter candidates - each still passes the sim's staffing gate. */
      readonly jobPriority: readonly number[];
    }
  | {
      /**
       * Employ a group of owned settlers at `building`, nearest the building first: the unemployed
       * members while there are any, otherwise the members employed elsewhere. Every member is tried as
       * its own `assignWorker`, so the building's staffing gate decides who still fits. Authored group
       * order.
       */
      readonly kind: 'assignWorkerGroup';
      readonly building: Entity;
      readonly members: readonly GroupWorker[];
    }
  | {
      /**
       * Send one owned settler to answer `need` now, whatever its bar reads - the original's eat, sleep,
       * talk and pray buttons. The drive ladder runs that need's rung as if it were pressing until the
       * answering atomic lands, and the order outranks a prohibited regeneration.
       */
      readonly kind: 'orderNeed';
      readonly entity: Entity;
      readonly need: NeedKind;
    }
  | {
      /**
       * Allow or prohibit one owned soldier's regeneration. A soldier that may not regenerate answers a
       * need only from what it carries and never walks off to food, a bed, or a temple; an explicit
       * `orderNeed` still moves it. Every settler starts allowed, and a trade change restores that.
       */
      readonly kind: 'setRegeneration';
      readonly entity: Entity;
      readonly enabled: boolean;
    }
  | {
      /**
       * Unpin one owned builder from the site an `assignBuilder` order bound it to - the original's
       * "Remove Building Site". The builder keeps its trade and any workplace, and falls back to the
       * nearest-site pick.
       */
      readonly kind: 'unassignBuilder';
      readonly entity: Entity;
    }
  | {
      /**
       * Call off one owned settler's barracks drill - the original's "Remove Learning Place". The drill
       * already served is lost, since nothing banks a part-finished course.
       */
      readonly kind: 'cancelTraining';
      readonly entity: Entity;
    }
  | {
      /**
       * Drive one owned vehicle to (x,y), the original's `e` order: the target snaps to the nearest node
       * the vehicle may stand on within `VEHICLE_TARGET_SNAP_RADIUS`, on the vehicle's own continent and
       * within its walk range. Refused with a `vehicleMoveRefused` event while nobody commands it or
       * when nothing leads there.
       */
      readonly kind: 'moveVehicle';
      readonly vehicle: Entity;
      readonly x: number;
      readonly y: number;
    }
  | {
      /**
       * Dock one owned ship at the shore point (x,y), the original's `g` order: the ship boards its crew
       * first, sails to a node of its own water body on the hexagon ring of its door distance around
       * the point, and lies moored there with the point as its door. Refused with a
       * `vehicleMoveRefused` event while nobody commands it or when no ring node takes it; ignored for
       * a vehicle that is not a ship.
       */
      readonly kind: 'dockVehicle';
      readonly vehicle: Entity;
      readonly x: number;
      readonly y: number;
    }
  | {
      /** Stop one owned vehicle's drive on the node it is crossing, the original's `p` order; its task
       *  then reads `interrupted` until the next order. */
      readonly kind: 'stopVehicle';
      readonly vehicle: Entity;
    }
  | {
      /**
       * Attach one owned settler to one owned `vehicle` as its crew (the original's attach order):
       * the commander slot first, then a free ordinary slot, with no distance check. Refused with a
       * `riderRefused` event when the type's `passengerJobs` exclude the settler's trade and with
       * `vehicleCrewRefused` when every slot is taken. The settler leaves its workplace, drops its fight
       * and walks to the vehicle's door; attaching to another vehicle detaches first.
       */
      readonly kind: 'attachToVehicle';
      readonly entity: Entity;
      readonly vehicle: Entity;
    }
  | {
      /**
       * Free one owned settler from its vehicle: a rider aboard steps onto the door node, one still
       * walking is released where it stands, and a departing commander promotes the first ordinary
       * passenger. Refused with `riderRefused` aboard a ship that is not moored.
       */
      readonly kind: 'detachFromVehicle';
      readonly entity: Entity;
    }
  | {
      /** Ask one owned attached settler to step inside its vehicle: it boards on reaching the
       *  door node. Refused with `riderRefused` for a ship lying at sea. */
      readonly kind: 'boardVehicle';
      readonly entity: Entity;
    }
  | {
      /** Put one owned vehicle's whole crew onto its door node and free them (the original's `f` on a
       *  ship). Ignored while the door is at sea. */
      readonly kind: 'unloadPeople';
      readonly vehicle: Entity;
    }
  | {
      /**
       * Ask for `amount` units of `goodType` in one owned vehicle's hold (the original's `m`): the
       * amount is clamped so the wanted amounts over every good fit the type's `stockSlots`, and an
       * attached carrier fetches or flushes toward it. A vehicle with no carrier attached takes the
       * request and raises `vehicleCrewRefused` with `noCarrier`. An uncarriable good is ignored.
       */
      readonly kind: 'setVehicleWanted';
      readonly vehicle: Entity;
      readonly goodType: number;
      readonly amount: number;
    }
  | {
      /** Ask for nothing in one owned vehicle's hold (the original's `n`): every wanted amount to 0, so
       *  an attached carrier flushes the hold out. The same `noCarrier` note as `setVehicleWanted`. */
      readonly kind: 'clearVehicleWanted';
      readonly vehicle: Entity;
    }
  | {
      /**
       * Load one owned cart or catapult into one owned ship `carrier` (the original's `q` then `s`): the
       * vehicle boards its own crew, drives to the carrier's door and rides inside. Refused with
       * `vehicleCrewRefused` when the carrier's `passengerJobs` exclude the vehicle's job, its vehicle
       * slots are full, its passenger room cannot take the crew, it lies at sea, or the door is off the
       * vehicle's continent.
       */
      readonly kind: 'loadIntoVehicle';
      readonly vehicle: Entity;
      readonly carrier: Entity;
    }
  | {
      /** Take one owned vehicle off its carrier (`r`): a vehicle riding inside is set down on the
       *  carrier's door node, one still on its way is merely released. Refused with `vehicleCrewRefused`
       *  inside a ship that is not moored. */
      readonly kind: 'leaveCarrier';
      readonly vehicle: Entity;
    }
  | {
      /**
       * Send one owned scout to explore around (x,y): it walks to unexplored ground within
       * `EXPLORE_RADIUS_NODES` of that centre, one point at a time, until nothing there is left unseen.
       */
      readonly kind: 'exploreArea';
      readonly entity: Entity;
      readonly x: number;
      readonly y: number;
    }
  | {
      /**
       * Take one owned settler off its workplace, keeping its trade - the original's "Remove Work Place"
       * (`humanwindow` 32). Nothing re-employs it, so it stays trade-ful and unposted until the player
       * posts it again.
       */
      readonly kind: 'unassignWorker';
      readonly entity: Entity;
    }
  | {
      /**
       * Pin one owned builder to construction `site`, or to a damaged building it then mends whatever
       * fighting is near while its repair crew has room, so it works there over the nearest one. Only a job
       * that can run the build atomic qualifies; other trades take the `assignWorker` path.
       */
      readonly kind: 'assignBuilder';
      readonly entity: Entity;
      readonly site: Entity;
    }
  | {
      /**
       * Place or move one unposted field worker's flag to (x,y). A gatherer searches its radius; a fisher
       * uses it as the yard where the catch is banked. A worker posted to a building banks there instead,
       * so this order is ignored until it is unassigned. The flag itself holds no stockpile.
       */
      readonly kind: 'setWorkFlag';
      readonly entity: Entity;
      readonly x: number;
      readonly y: number;
    }
  | {
      /** Choose which map good a flag-bound gatherer harvests. `null` restores the all-goods mode. The
       * selected good must expose a non-farming harvest atomic allowed by the settler's current job. */
      readonly kind: 'setGatherGood';
      readonly entity: Entity;
      readonly goodType: number | null;
    }
  | {
      /**
       * Send one owned scout to erect a signpost at (x,y): it walks there and plays the build-guide
       * atomic (`jobtypes.ini` scout `allowatomic 43`, `viking_scout_build_guide`). Observation: the
       * signpost is instant and free.
       */
      readonly kind: 'placeSignpost';
      readonly entity: Entity;
      readonly x: number;
      readonly y: number;
    }
  | {
      /**
       * Choose which of its workplace's products a craft worker makes; several selected alternate per
       * started cycle, and an empty list restores the all-products mode. Goods the workplace does not
       * make are dropped, and a selection with none left is ignored.
       */
      readonly kind: 'setCraftGoods';
      readonly entity: Entity;
      readonly goods: readonly number[];
    }
  | {
      /**
       * Send one owned adult settler to drill at barracks `house` for `BARRACKS_DRILL_TICKS`; it comes
       * out enlisted as the base soldier class and stays qualified for the soldier trades. A settler that
       * already holds a fighter trade only drills. A `moveUnit` order calls the errand off.
       */
      readonly kind: 'trainSoldier';
      readonly entity: Entity;
      readonly house: Entity;
    }
  | {
      readonly kind: 'learn';
      readonly entity: Entity;
      readonly house: Entity;
      readonly target: 'job' | 'good';
      readonly typeId: number;
    }
  | {
      /**
       * Order one owned unmarried adult settler to seek the nearest eligible partner of its tribe and
       * wed. Soldiers and scouts are ineligible on either side, and the order auto-cancels when no
       * eligible partner exists right now.
       */
      readonly kind: 'marry';
      readonly entity: Entity;
    }
  | {
      /**
       * House one owned adult settler's whole family (the settler, its spouse, their still-growing child)
       * in `house`. A home holds up to `homeSize` families (`houses.ini` `logichomesize`, 1..5 by level);
       * re-assigning moves the family out of its previous home.
       */
      readonly kind: 'assignHouse';
      readonly entity: Entity;
      readonly house: Entity;
    }
  | {
      /**
       * House a group of owned adult settlers' families in `house`, nearest the house first: the
       * homeless families while there are any, otherwise the families housed elsewhere, while it has a
       * free family slot. Every member is tried as its own `assignHouse`. Authored group order.
       */
      readonly kind: 'assignHouseGroup';
      readonly members: readonly GroupMember[];
      readonly house: Entity;
    }
  | {
      /**
       * Move one owned adult settler's whole family out of its home, freeing the family slot. Authored:
       * the original has no readable "remove from home" primitive; this mirrors the housed-as-one family.
       */
      readonly kind: 'unassignHouse';
      readonly entity: Entity;
    }
  | {
      /**
       * Put `goodType` on in equipment slot (`group`, `slot`); the good's `equip.category` must match
       * `group`. No source holding the good makes the errand return empty-handed rather than rejecting
       * the command.
       */
      readonly kind: 'equipGood';
      readonly entity: Entity;
      readonly group: EquipCategory;
      /** The misc row's slot index; 0 for the single-slot groups. */
      readonly slot: number;
      readonly goodType: number;
      /** Skip the walk back to the issue spot: the errand ends where the fetch, or the stow of a
       *  swapped-out good, leaves the settler. */
      readonly skipReturn?: boolean;
    }
  | {
      /**
       * Take the good in equipment slot (`group`, `slot`) off at its stow store; a part-used unit is
       * instead destroyed in place.
       */
      readonly kind: 'unequipGood';
      readonly entity: Entity;
      readonly group: EquipCategory;
      /** The misc row's slot index; 0 for the single-slot groups. */
      readonly slot: number;
    }
  | {
      /**
       * Order one owned married woman to make a child of the chosen sex - a standing order that persists
       * until the birth succeeds. Re-issuing replaces the chosen sex.
       */
      readonly kind: 'makeChild';
      readonly entity: Entity;
      readonly child: (typeof CHILD_SEXES)[number];
    }
  | {
      /**
       * Raise or lower the alarm on one owned garrison building. While it is up the owner's civilians
       * shelter inside, up to the type's `shelterCapacity`, and the building fires the house bow; lowering
       * it releases everyone sheltering there.
       */
      readonly kind: 'setDefenceMode';
      readonly building: Entity;
      readonly enabled: boolean;
    }
  | {
      /** Allow or forbid consumption of one durable household quality in an owned finished home. */
      readonly kind: 'setHouseholdGoodUse';
      readonly player: number;
      readonly effect: HomeQualityEffect;
      readonly allowed: boolean;
    };

/**
 * The settler that answers a player's order with its voice, or undefined for a command aimed at a
 * building, the map or the seat itself. `entity` is the unit-order vocabulary's addressee field (an
 * order's other party rides as `chest`, `target`, `house`...); a group order answers with its first
 * member. The panel pickers answer too: the job, equipment, produced-good, learn and trader windows.
 */
export function orderedSettler(command: Command): Entity | undefined {
  if ('entity' in command) return command.entity;
  if ('members' in command) return command.members[0]?.entity;
  return undefined;
}
