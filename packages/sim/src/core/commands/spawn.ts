/**
 * One equipped item in a {@link spawnSettler} `equipment` payload. `goodType` is the equip good's
 * `typeId`; `degreeOfUsePct` is the item's used-up fraction as a whole percent `0..100` (converted to
 * the `Equipment` component's `Fixed` `degreeOfUse` by the handler, the same raw-int→`Fixed` conversion
 * `moveSpeed` uses — the command stays serializable, no branded `Fixed` on the wire). Omit
 * `degreeOfUsePct` for a fresh item. Meaningful only for a wearing good; ignored for permanent gear.
 */
export interface SettlerEquipmentSlot {
  readonly goodType: number;
  readonly degreeOfUsePct?: number;
}

/**
 * A {@link spawnSettler} `equipment` payload — which items a spawned settler wears. Each field is one
 * slot; `misc` is the consumable list (padded/truncated to the component's fixed misc-slot count). Any
 * omitted / null slot is empty.
 */
export interface SettlerEquipment {
  readonly boots?: SettlerEquipmentSlot | null;
  readonly tool?: SettlerEquipmentSlot | null;
  readonly weapon?: SettlerEquipmentSlot | null;
  readonly armor?: SettlerEquipmentSlot | null;
  readonly misc?: ReadonlyArray<SettlerEquipmentSlot | null>;
}

/** Commands that create living settlers or wildlife herds. */
export type SpawnCommand =
  | {
      /**
       * Spawn one {@link Settler} of `jobType` for `tribe` at (x,y). EVERY settler is stamped a
       * {@link Health} pool (civilians have health too — user decision 2026-07-11): a positive
       * `hitpoints` sets its size (the settler analogue of `spawnAnimalHerd`'s `hitpoints_adult`
       * stamp); omit it (the default) for the shared
       * {@link import('../../systems/conflict/spawn/index.js').DEFAULT_SETTLER_HITPOINTS} pool. The pool
       * **magnitude is approximated** either way: a human's hitpoints are below the readable `.ini`
       * (only `animaltypes.ini` carries them; source basis "Combat hit resolution").
       *
       * When `armorClass` is a positive `[armortype]` tier (1..4) the combatant also wears that armor
       * (an `Armor` component): an incoming hit is mitigated by the tier's `blockingValue` rather than
       * landing on the unarmored class 0. Omit it (the default) and the settler is unarmored.
       *
       * When `weaponTypeId` is a positive `[weapontype]` id the combatant wields THAT specific weapon
       * (a `Weapon` component) — resolved against its own tribe — instead of the default
       * `(tribe, jobType)` weapon scan. Omit it (the default) and the settler fights with its class's
       * default weapon (the first `(tribe, jobType)` match), exactly as before.
       */
      readonly kind: 'spawnSettler';
      readonly jobType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
      /** The settler's max hitpoint pool. Omit (or a non-positive value) for the default pool
       *  (`DEFAULT_SETTLER_HITPOINTS`) — every settler carries `Health`. */
      readonly hitpoints?: number;
      /** A combatant's worn armor class (a `[armortype]` tier 1..4; stamps an `Armor` component). Omit
       *  (or a non-positive value) for an unarmored combatant — every hit then lands on class 0. */
      readonly armorClass?: number;
      /** A combatant's wielded weapon `typeId` (a `[weapontype]`; stamps a `Weapon` component, resolved
       *  vs the settler's own tribe). Omit (or a non-positive value) to fight with the class's default
       *  `(tribe, jobType)` weapon. */
      readonly weaponTypeId?: number;
      /**
       * The settler's worn **equipment** — stamps an `Equipment` component (boots/tool/consumables, and
       * a soldier's weapon/armour slots). Omit (the default) and the settler carries none, the
       * separate-optional-component path whose hash this leaves untouched. This is the equipment
       * INVENTORY/display axis, independent of the combat `weaponTypeId`/`armorClass` above (a unit that
       * both fights and displays gear sets both). See {@link SettlerEquipment}. */
      readonly equipment?: SettlerEquipment;
      /**
       * The settler's walk pace as **ticks to cross one tile** (the animal `movespeed` semantics: a
       * `MoveSpeed{perTick = ONE/moveSpeed}` is stamped, so a *larger* value walks a *slower* step).
       * Omit (or a non-positive value) — the default — and the settler carries NO `MoveSpeed` and walks
       * at the universal {@link import('../../systems/movement/movement.js').MOVE_SPEED_PER_TICK} (the golden
       * / vertical-slice path whose hash this leaves untouched), the same separate-optional-component
       * stance as `hitpoints`/`armorClass`/`weaponTypeId` above. Used to give a *visually* slower pace in
       * acceptance scenes without retuning the global default (see source basis "Settler walk pace").
       */
      readonly moveSpeed?: number;
      /** The PLAYER that owns this settler (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). Omit
       *  (or an out-of-range value) for a neutral/unowned settler — the golden path, hash untouched.
       *  Orthogonal to `tribe` (the civilization). Only an owned settler is selectable/orderable. */
      readonly owner?: number;
    }
  | {
      /**
       * Spawn a **herd of an animal tribe** around a birth point — `maximumgroupsize` creatures of
       * `tribe` scattered within `maximumdistancetobirthpoint` of (x,y), each a {@link Settler} of that
       * animal tribe carrying a {@link Health} pool from `hitpoints_adult`, with a designated leader
       * when the animal's `searchforleader` is set. The seam wildlife enters the world through (the
       * animal analogue of `spawnSettler`/`placeBuilding`); the AnimalSystem/map-populator that *issues*
       * these is a later slice — this command lands the placement mechanic. A `tribe` with no
       * `animaltypes` record (a civilization, an unknown tribe) is bad input and skipped.
       */
      readonly kind: 'spawnAnimalHerd';
      readonly tribe: number;
      readonly x: number;
      readonly y: number;
    };
