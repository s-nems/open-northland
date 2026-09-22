import type { EquipCategory, HomeQualityEffect } from '@open-northland/data';
import type { NeedKind } from '../../components/needs.js';
import type { Entity } from '../../ecs/world.js';
import type { Command } from './index.js';

/** The sexes a `makeChild` order may ask for. */
export const CHILD_SEXES = ['female', 'male'] as const;

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
       * Focus one owned combatant on `target` until the target dies, overriding sight-radius
       * auto-engagement. Hostility is re-validated each tick by the CombatSystem, not at issue.
       */
      readonly kind: 'attackUnit';
      readonly entity: Entity;
      readonly target: Entity;
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
       * Pin one owned builder to construction `site` so it raises that site over the nearest one. Only a
       * job that can run the build atomic qualifies; other trades take the `assignWorker` path.
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
       * shelter inside and shoot the house bow, up to the type's `shelterCapacity`; lowering it releases
       * everyone sheltering there.
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
 * The settler a player's order addresses, or undefined for a command aimed at a building, the map or
 * the seat itself. `entity` is the unit-order vocabulary's addressee field alone (an order's other party
 * rides as `chest`, `target`, `house`...), so its presence is the test - the original's `AddHumanCommand`
 * family, which the client answers with the settler's voice. That covers the panel pickers too: the
 * job, equipment, produced-good, learn and trader windows are among `PlayRespondingSound`'s callers.
 */
export function orderedSettler(command: Command): Entity | undefined {
  return 'entity' in command ? command.entity : undefined;
}
