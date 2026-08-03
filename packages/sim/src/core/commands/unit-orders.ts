import type { EquipCategory } from '@open-northland/data';
import type { Entity } from '../../ecs/world.js';

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
       * Change one owned settler's trade: set `jobType` and reset it to an unposted idle worker of that
       * trade. The civilist job (`jobtypes.ini` 6) is an ordinary assignable record no workplace employs.
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
       * Pin one owned builder to construction `site` so it raises that site over the nearest one. Only a
       * job that can run the build atomic qualifies; other trades take the `assignWorker` path.
       */
      readonly kind: 'assignBuilder';
      readonly entity: Entity;
      readonly site: Entity;
    }
  | {
      /**
       * Place or move one owned gatherer's work flag to (x,y). The gatherer then harvests only within
       * that flag's radius and banks its harvest on the ground beside it; the flag holds no stockpile.
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
      readonly child: 'female' | 'male';
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
    };
