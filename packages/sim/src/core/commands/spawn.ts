/**
 * One equipped item in a {@link spawnSettler} `equipment` payload. `goodType` is the equip good's
 * `typeId`; `degreeOfUsePct` is the item's used-up fraction as a whole percent `0..100`, omitted for a
 * fresh item and meaningful only for a wearing good.
 */
export interface SettlerEquipmentSlot {
  readonly goodType: number;
  readonly degreeOfUsePct?: number;
}

/**
 * A {@link spawnSettler} `equipment` payload - which items a spawned settler wears. Each field is one
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

/**
 * Put a vehicle of `vehicleType` on the map at half-cell node (x,y) for `tribe`, at full hit points
 * with an empty hold and no crew. A ship spawns moored when land lies within its door distance. Trusted
 * only: a yard's finished site, a decoded map's `setvehicle`, a chest reward. A `vehicleType` the
 * content lacks is skipped.
 */
export interface CreateVehicleCommand {
  readonly kind: 'createVehicle';
  readonly vehicleType: number;
  readonly x: number;
  readonly y: number;
  readonly tribe: number;
  /** The owning player (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). Omit for a vehicle nobody
   *  commands. */
  readonly owner?: number;
  /** The {@link MissionObjectId} to stamp; omit or 0 for a vehicle no script addresses. */
  readonly missionId?: number;
}

/** Commands that create living settlers, wildlife herds or vehicles. */
export type SpawnCommand =
  | CreateVehicleCommand
  | {
      /**
       * Spawn one {@link Settler} of `jobType` for `tribe` at (x,y). Every settler, civilians included,
       * is stamped a {@link Health} pool: a positive `hitpoints` sets its size, otherwise it is the
       * tribe's adult pool, or `DEFAULT_SETTLER_HITPOINTS` when the job's slug is a baby/child stage.
       * Approximation: human hitpoints are not in the readable data (source basis "Combat hit
       * resolution"), so every pool a human carries is authored.
       */
      readonly kind: 'spawnSettler';
      readonly jobType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
      /** The settler's max hitpoint pool. Omit (or a non-positive value) for the stage-appropriate pool
       *  above. */
      readonly hitpoints?: number;
      /** A combatant's worn armor class (a `[armortype]` tier 1..4; stamps an `Armor` component), which
       *  selects the damage column an incoming hit reads. Omit (or a non-positive value) for an
       *  unarmored combatant - every hit then lands on class 0. */
      readonly armorClass?: number;
      /** A combatant's wielded weapon `typeId` (a `[weapontype]`; stamps a `Weapon` component, resolved
       *  vs the settler's own tribe). Omit (or a non-positive value) to fight with the class's default
       *  `(tribe, jobType)` weapon. */
      readonly weaponTypeId?: number;
      /** The settler's worn equipment (stamps an `Equipment` component), an inventory/display axis
       *  independent of the combat `weaponTypeId`/`armorClass` above. Omit and the settler carries none,
       *  except that a soldier whose weapon slot is left unnamed holds its class weapon good. */
      readonly equipment?: SettlerEquipment;
      /**
       * The settler's walk pace as ticks to cross one tile (an explicit distance override: a
       * `MoveSpeed{perTick = ONE/moveSpeed}` is stamped, so a larger value walks a slower step). Omit
       * (or a non-positive value) and the settler carries no `MoveSpeed` and walks the original's
       * per-step cost (`walkStepTicks`).
       */
      readonly moveSpeed?: number;
      /** The player that owns this settler (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). An explicit
       *  out-of-range value rejects the command; omit it for a neutral settler. Orthogonal to `tribe` (the
       *  civilization). Only an owned settler is selectable/orderable. */
      readonly owner?: number;
      /** Starting specialization XP as `[trackTypeId, points]` pairs. Omit for a fresh settler. */
      readonly experience?: ReadonlyArray<readonly [number, number]>;
      /** A gatherer's starting resource pick, narrowing its auto-planted work flag to one good (a decoded
       *  map's `setproducedgood`). Omit to gather every good the trade may harvest. Ignored for a
       *  non-gathering trade, or a good that trade cannot harvest. */
      readonly gatherGood?: number;
      /** The half-cell anchor of the home this settler moves into as it spawns (a decoded map's
       *  `attachtohouse`), admitted on the same terms as an `assignHouse` order minus its signpost area
       *  gate. Omit for a settler its map leaves homeless. */
      readonly home?: { readonly x: number; readonly y: number };
      /** The half-cell anchor of the workplace this settler is posted to as it spawns (a decoded map's
       *  `attachtohouse`). Only its own trade's slot is taken, so a full or unrelated building leaves it
       *  unposted rather than demoting it to a hauler. */
      readonly workplace?: { readonly x: number; readonly y: number };
      /** The {@link MissionObjectId} to stamp; omit for a settler no mission addresses. */
      readonly missionId?: number;
      /** The `sethuman` behaviour mask, stamped as a {@link MissionBehaviour}; omit (or 0) for none. */
      readonly behaviourFlags?: number;
      /** The map's `[misc_humannames]` name for this settler, as a string id in the map's own table;
       *  omit for a settler the map left unnamed. */
      readonly nameStringId?: number;
    }
  | {
      /**
       * Spawn a herd of an animal tribe around a birth point: `maximumgroupsize` creatures of `tribe`
       * scattered within `maximumdistancetobirthpoint` of (x,y). A `tribe` with no `animaltypes` record
       * is skipped.
       */
      readonly kind: 'spawnAnimalHerd';
      readonly tribe: number;
      readonly x: number;
      readonly y: number;
      /** Herd-size override: spawn exactly `max(1, count)` creatures instead of the record's
       *  `maximumgroupsize` - a decoded map's `setanimal` places one animal at its authored
       *  half-cell. Omit for the record's herd size. */
      readonly count?: number;
      /** The {@link MissionObjectId} to stamp on every member of the herd. */
      readonly missionId?: number;
      /** The player that owns the herd (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). Omit, or
       *  name the wild slot a `setanimal` writes, for creatures nobody owns. */
      readonly owner?: number;
    };
