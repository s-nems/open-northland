import type { Entity } from '../ecs/world.js';

/**
 * Player commands are the ONLY way sim state mutates (CommandSystem applies them). They must be
 * serializable (a save is a command log; lockstep MP exchanges them) and exhaustively handled.
 *
 * Every `(x, y)` payload is a HALF-CELL node address on the `2W×2H` navigation lattice
 * (`nav/halfcell.ts`) — the original's logic grid, the same space `map.cif` placements and footprint
 * offsets use. The handlers mint fractional tile Positions from it via `positionOfNode`.
 *
 * This is a discriminated union, not a bag of methods or numeric opcodes — adding a variant forces
 * every handler's `switch` to acknowledge it (via assertNever), which is the modern guard against
 * the original's "magic number opcode" fragility. Grow this as Phase 2 systems land.
 */
export type Command =
  | {
      /**
       * Place a {@link Building} of `buildingType` at (x,y) for `tribe`. By default the building is
       * **fully built** (`built = ONE`) — the vertical-slice path. When `underConstruction` is set the
       * building instead enters at `built = 0`: the ConstructionSystem advances it to built once its
       * `construction` material cost is delivered into its own stockpile (the deliver-materials-then-build
       * loop). This is the opt-in richer entity, the same shape as `spawnSettler{hitpoints}` — omit it and
       * nothing changes (the golden / placed-already-built path). A type with an empty `construction` cost
       * (the headquarters, a free type) finishes on the first construction tick.
       */
      readonly kind: 'placeBuilding';
      readonly buildingType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
      /** Start the building at `built = 0` (under construction) rather than already built. Omit (the
       *  default) for an immediately-built placement. */
      readonly underConstruction?: boolean;
      /** The PLAYER that owns this building (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). Omit
       *  (or an out-of-range value) for a neutral/unowned building — the golden path, hash untouched.
       *  Orthogonal to `tribe` (the civilization). */
      readonly owner?: number;
      /** Skip the tech + ground-collision gates and place as-is. For MAP-AUTHORED imports (a decoded
       *  map's `sethouse` records) and pinned demo fixtures: the original loads a map's houses
       *  verbatim, it never re-validates them against the interactive placement rule. A player-issued
       *  placement must NOT set this — the UI goes through the gated path. */
      readonly force?: boolean;
    }
  | {
      /**
       * Spawn one {@link Settler} of `jobType` for `tribe` at (x,y). When `hitpoints` is given (a
       * positive pool) the settler is a **combatant** — it is stamped a {@link Health} pool of that size
       * and so can fight and be felled (the settler analogue of `spawnAnimalHerd`'s `hitpoints_adult`
       * stamp); omit it (the default) and the settler is a non-combatant with no `Health`, the golden /
       * vertical-slice path whose hash this leaves untouched. The pool **magnitude is caller-supplied**:
       * a human's hitpoints are below the readable `.ini` (only `animaltypes.ini` carries them), so this
       * value is *approximated*, not pinned to a param (source basis "Combat hit resolution").
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
      /** A combatant's max hitpoint pool (stamps a {@link Health} pool). Omit for a non-combatant. */
      readonly hitpoints?: number;
      /** A combatant's worn armor class (a `[armortype]` tier 1..4; stamps an `Armor` component). Omit
       *  (or a non-positive value) for an unarmored combatant — every hit then lands on class 0. */
      readonly armorClass?: number;
      /** A combatant's wielded weapon `typeId` (a `[weapontype]`; stamps a `Weapon` component, resolved
       *  vs the settler's own tribe). Omit (or a non-positive value) to fight with the class's default
       *  `(tribe, jobType)` weapon. */
      readonly weaponTypeId?: number;
      /**
       * The settler's walk pace as **ticks to cross one tile** (the animal `movespeed` semantics: a
       * `MoveSpeed{perTick = ONE/moveSpeed}` is stamped, so a *larger* value walks a *slower* step).
       * Omit (or a non-positive value) — the default — and the settler carries NO `MoveSpeed` and walks
       * at the universal {@link import('../systems/movement/movement.js').MOVE_SPEED_PER_TICK} (the golden
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
    }
  | {
      /**
       * Place a **boat hull** of `vehicleType` at (x,y) for `tribe` — a ship put on the map as a
       * **mobile store** (the boat analogue of `placeBuilding`): it creates a {@link Vehicle} hull
       * carrying an (empty) {@link Stockpile} whose capacity is the ship type's `stockSlots`, the
       * "boats as mobile stores" entity the Sea/Northland plan item names. Gated by the tribe's
       * ship-unlock tech graph (`tribeShipsUnlocked`): a hull is placed only if `vehicleType` is a
       * ship the tribe has currently UNLOCKED (a `vehicle_ship` row whose `jobEnablesVehicle` edge is
       * satisfied), so a cart, a catapult, or a not-yet-unlocked ship is a recoverable bad command —
       * skipped (still logged for faithful replay), the same stance as a tech-gated `placeBuilding`.
       * Loading cargo onto the hold (applying the `cargoGoods` filter) and embark/disembark are
       * deferred follow-ups — this command lands the hull-as-mobile-store entity they build on.
       */
      readonly kind: 'placeBoat';
      readonly vehicleType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
      /** The PLAYER that owns this boat (a slot in `[0, MAX_PLAYERS)`; stamps an `Owner`). Omit (or
       *  an out-of-range value) for a neutral/unowned hull — the golden path, hash untouched.
       *  Orthogonal to `tribe` (the civilization). */
      readonly owner?: number;
    }
  | { readonly kind: 'setProduction'; readonly building: Entity; readonly goodType: number }
  | { readonly kind: 'demolish'; readonly building: Entity }
  | {
      /**
       * Order one OWNED settler to walk to (x,y) — the RTS "go there" order (the FIRST command that
       * steers an existing unit rather than creating one). It sets a `MoveGoal` (the existing
       * pathfinding→movement pipeline carries it out) + a `PlayerOrder` soft timed override, so the
       * unit stands a while on arrival before the economy AI reclaims it. Skipped for a dead/stale
       * target, a non-settler, or a neutral (unowned) entity. See the `moveUnit` handler.
       */
      readonly kind: 'moveUnit';
      readonly entity: Entity;
      readonly x: number;
      readonly y: number;
    }
  | {
      /**
       * Change one OWNED settler's profession (the settler UI's "zmiana zawodu"): set its `jobType`
       * and reset it to a fresh idle worker of the new trade (drop its workplace binding, cancel its
       * action/route/order) so the JobSystem re-employs it. Skipped for a dead/stale target, a
       * non-settler, a neutral entity, an unknown `jobType`, or a still-growing child. See `setJob`.
       */
      readonly kind: 'setJob';
      readonly entity: Entity;
      readonly jobType: number;
    }
  | {
      /**
       * Order one OWNED combatant to ATTACK a specific `target` unit — the RTS "attack that one" order
       * (the combat twin of `moveUnit`). It stamps an `AttackOrder` focus so the unit chases and strikes
       * `target` **regardless of sight radius** until the target dies / stops being a valid target (then
       * it reverts to auto-engagement). Like `moveUnit` it is authoritative — it cancels the unit's
       * current action/route so it obeys at once. Skipped for a dead/stale/non-combatant issuer or target,
       * a neutral (unowned) issuer, or a self-target. The move-order-onto-an-enemy idiom the app maps to
       * this (right-click on an enemy = attack) is the original's RTS convention (source basis).
       * The command carries no issuing-player yet (the per-player authority check lands with lockstep),
       * and hostility is (re)validated each tick by the CombatSystem, not at issue. See `attackUnit`.
       */
      readonly kind: 'attackUnit';
      readonly entity: Entity;
      readonly target: Entity;
    }
  | {
      /**
       * Set one OWNED unit's **military stance** — the original's per-unit `MILITARY_MODE`
       * (`setStance`), the player's control over how a unit reacts to enemies: `ATTACK` (auto-engage on
       * sight), `DEFEND` (hold a radius around where the stance was set), `IGNORE` (never auto-engage —
       * the scout's mode), `FLEE` (run from danger — the civilian's mode). The CombatSystem gates
       * auto-engagement on the resulting {@link import('../components/index.js').Stance}; an explicit
       * {@link Command} `attackUnit` order still overrides the mode (fight THAT one regardless of stance).
       *
       * For `DEFEND` the unit's current tile is captured as the defend **anchor** (the centre of the
       * defend radius / the tile it returns to when clear). Recoverable bad input (skipped, still logged
       * for faithful replay): a dead/stale target, a non-settler, a NEUTRAL (unowned — not the player's to
       * command) entity, or a `mode` outside the five `MILITARY_MODE` ids. Carries no issuing-player yet
       * (the per-player authority check lands with lockstep). See `setStance`.
       */
      readonly kind: 'setStance';
      readonly entity: Entity;
      /** The target {@link import('../systems/readviews/stances.js').MILITARY_MODE} id (0..4). */
      readonly mode: number;
    };

/**
 * A command stamped with the tick it is applied on. This is the unit of the **command log** — the
 * append-only record that IS the save format (replay the log from seed 0 to reach any state) and the
 * lockstep-multiplayer wire format (peers exchange `LoggedCommand`s, apply them on the same tick).
 * The log is built from tick 1 even before there's a disk format: the invariant ("the only way state
 * mutates is an applied command") is what matters now, not where the bytes land.
 */
export interface LoggedCommand {
  /** The tick on which CommandSystem applied this command (`Simulation.tick` at apply time). */
  readonly tick: number;
  readonly command: Command;
}

/**
 * The command queue — the single mutation seam into the sim. Player/UI/AI code (and a replaying save
 * loader) call {@link enqueue}; nothing else touches world state directly. Each tick CommandSystem
 * {@link drain}s the pending commands (in FIFO enqueue order — deterministic, no Map/Set iteration)
 * and applies them, appending each to the {@link log}. Determinism: the queue is a plain array, so
 * apply order is exactly enqueue order; two runs that enqueue the same commands on the same ticks
 * produce byte-identical state.
 */
export class CommandQueue {
  private pending: Command[] = [];
  private readonly applied: LoggedCommand[] = [];

  /** Queue a command to be applied on the next tick's CommandSystem pass. */
  enqueue(command: Command): void {
    this.pending.push(command);
  }

  /** Number of commands waiting to be applied (not yet drained). */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Take and clear the pending commands (CommandSystem-only). Returns them in enqueue order; the
   * caller is responsible for recording each applied command via {@link record}.
   */
  drain(): readonly Command[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Append an applied command to the log (CommandSystem-only, after it applies the command). */
  record(tick: number, command: Command): void {
    this.applied.push({ tick, command });
  }

  /** The append-only command log — the save / replay / lockstep record. Read-only to consumers. */
  get log(): readonly LoggedCommand[] {
    return this.applied;
  }
}

/**
 * The effect an atomic action applies on completion. Keeps the numeric `atomicId` as the content
 * cross-reference (required for fidelity), but the EFFECT a system applies is a typed union so the
 * AtomicSystem's apply switch is exhaustive and golden traces are human-readable, not opaque ints.
 */
export type AtomicEffect =
  | { readonly kind: 'move'; readonly to: { x: number; y: number } }
  | { readonly kind: 'harvest'; readonly resource: Entity; readonly goodType: number }
  | {
      readonly kind: 'pickup';
      readonly goodType: number;
      readonly amount: number;
      /** The store the goods come OUT of (a workplace's stockpile a carrier hauls from), or null
       *  for a sourceless pickup (the goods appear on the settler's back without a source). Goods
       *  are conserved: a pickup `from` a store removes exactly what it adds to the carrier. */
      readonly from: Entity | null;
    }
  | { readonly kind: 'pileup'; readonly store: Entity }
  | { readonly kind: 'produce'; readonly recipeOutput: number }
  | {
      readonly kind: 'eat';
      readonly goodType: number;
      /** The store the food is consumed FROM (a stockpile the eater stands on), or null when the
       *  eater consumes a unit it already carries. One unit of `goodType` is removed on completion —
       *  eating destroys the food (it is conserved up to that consumption: nothing is conjured). */
      readonly from: Entity | null;
    }
  /** The settler sleeps to restore rest: zeroes its `fatigue` on completion (no goods consumed —
   *  unlike `eat`, resting is free). The pairing reset for the NeedsSystem's fatigue rise. */
  | { readonly kind: 'sleep' }
  /** The settler prays to restore devotion: zeroes its `piety` on completion (no goods consumed —
   *  like `sleep`, praying is free). The pairing reset for the NeedsSystem's piety rise. Unlike
   *  `sleep` (in place) this is the first **target-bound** need — the settler must stand on a temple
   *  to run it (the planner walks it there first). */
  | { readonly kind: 'pray' }
  /** The settler enjoys itself to restore leisure: zeroes its `enjoyment` on completion (no goods
   *  consumed — like `sleep`/`pray`, recreation is free). The pairing reset for the NeedsSystem's
   *  enjoyment rise (the `enjoy` atomic, id 17). The need→satisfier *drive* is deferred — `enjoy` has
   *  no readable building satisfier to walk to (see source basis) — so for now this effect is the
   *  reset half, exercised directly (no planner branch chooses it yet). */
  | { readonly kind: 'enjoy' }
  /** The settler makes love to restore leisure: zeroes its `enjoyment` on completion (no goods
   *  consumed — like `enjoy`/`sleep`/`pray`). The `make_love` atomic (id 78) is NOT a separate need —
   *  its animation (`viking_civilist_make_love`) restores the **same channel 3** as `enjoy` via
   *  `event <at> 3 +800` tuples (a bigger leisure boost than enjoy's +100), so it resets `enjoyment`
   *  too. The need→satisfier *drive* is deferred for the same reason as `enjoy` — no readable building
   *  satisfier in `houses.ini` (see source basis) — so for now this is the reset half only. */
  | { readonly kind: 'make_love' }
  /** The settler swings at `target`: the blow subtracts `damage` from the target's `Health.hitpoints`
   *  (clamped at 0 — armor never heals). `damage` is the **resolved column damage**, looked up by the
   *  planner from the weapon's `damagevalue[targetMaterial]` (the attacker's weapon × the target's armor
   *  material) and carried here already-resolved — exactly as `pickup`/`eat` carry a resolved `amount`,
   *  so the executor stays a pure subtraction with no content/weapon lookup of its own. The hit lands at
   *  `hitAt` (the animation's ATTACK-event frame, `ATOMIC_EVENT_TYPE_ATTACK`); when omitted it falls back
   *  to the completion frame (an animation with no ATTACK event). `weaponMainType` (the weapon's coarse
   *  class, `WeaponType.mainType`) keys the fight-experience bucket the swing accrues into; omitted → no
   *  fight XP (a weapon with no `mainType`). A `target` with no `Health` (already destroyed, or a
   *  non-combatant) is a no-op (the swing struck air).
   *
   *  `projectile` is present iff this is a **ranged** swing (a bow/catapult): at `hitAt` (the animation's
   *  release frame) the executor **launches a {@link import('../components/combat.js').Projectile}** toward
   *  `target` instead of landing the blow in place — the arrow/rock then flies (`projectileSystem`) and
   *  deals the SAME `damage` on contact (step 1's model, resolved on arrival). It carries the ammunition
   *  class + travel `speed` the projectile needs. Absent → a melee swing (the blow lands here at `hitAt`). */
  | {
      readonly kind: 'attack';
      readonly target: Entity;
      readonly damage: number;
      readonly hitAt?: number;
      readonly weaponMainType?: number;
      readonly projectile?: { readonly munitionType: number; readonly speed: number };
    }
  | { readonly kind: 'idle' };
