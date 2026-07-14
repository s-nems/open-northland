import type { Entity } from '../../ecs/world.js';

/** Commands that direct existing settlers and their work. */
export type UnitOrderCommand =
  | {
      /**
       * Order one OWNED settler to walk to (x,y) — the RTS "go there" order (the FIRST command that
       * steers an existing unit rather than creating one). It sets a `MoveGoal` (the existing
       * pathfinding→movement pipeline carries it out) + a `PlayerOrder` en-route marker; on arrival
       * the economy AI reclaims the unit at once (no post-arrival stand). Skipped for a dead/stale
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
       * auto-engagement on the resulting {@link import('../../components/index.js').Stance}; an explicit
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
      /** The target {@link import('../../systems/readviews/stances.js').MILITARY_MODE} id (0..4). */
      readonly mode: number;
    }
  | {
      /**
       * Assign one OWNED settler to work at a SPECIFIC `building` (the player-directed "employ this
       * colonist here", the counterpart to the JobSystem's automatic assignment): bind it to that
       * workplace ({@link JobAssignment}) and set its `jobType` to the building's open worker slot, the
       * same re-idle-to-a-fresh-worker reset as {@link setJob} but pinned to a building the player chose
       * rather than the first open one the economy finds. The bound settler then walks to and staffs
       * that building through the normal AI planner.
       *
       * `jobPriority` is the caller's ORDERED preference over which of the building's worker jobs to fill
       * — the sim walks it and binds the settler to the FIRST job that is genuinely open for it (the same
       * per-building openness gate the JobSystem applies — an understaffed slot at a same-tribe,
       * tech-enabled building whose job the settler qualifies for). This is how the app expresses the RTS
       * assignment intent (in *Cultures* a right-click makes a colonist a tradesman first, a hauler only
       * if the trade is full or the settler lacks its skill, and never a raw gatherer) WITHOUT letting the
       * UI bypass legality: the list only reorders/filters candidates — every entry still passes the sim's
       * gate, so a hand assignment can never reach a state the economy wouldn't. A job the building doesn't
       * offer (or that's full/gated) is skipped; an empty list, or one whose every entry is closed, is a
       * no-op. Recoverable bad input (skipped, still logged for faithful replay): a dead/stale/non-settler/
       * neutral issuer, a still-growing child, a dead/stale/non-building target, or no open job for this
       * settler (full, wrong tribe, not a workplace, or gated). See `assignWorker`.
       */
      readonly kind: 'assignWorker';
      readonly entity: Entity;
      readonly building: Entity;
      /** Ordered candidate worker jobs to try (highest preference first); the first open one wins. */
      readonly jobPriority: readonly number[];
    }
  | {
      /**
       * Assign one OWNED **builder** to a specific construction `site` (the original's "put a builder
       * on a foundation": right-clicking a site with a builder joins it to the crew). It pins a
       * {@link import('../../components/index.js').SiteAssignment} so the builder raises THAT site
       * (over the nearest one) and stays listed in its workers window until the site finishes.
       * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale/non-settler/
       * neutral issuer, a still-growing child, a dead or not-under-construction target, a wrong-tribe
       * site, or a settler whose job cannot run the build atomic (only the builder trade assigns —
       * a civilian right-clicked onto a normal building takes the `assignWorker` path instead). See
       * `assignBuilder`.
       */
      readonly kind: 'assignBuilder';
      readonly entity: Entity;
      readonly site: Entity;
    }
  | {
      /**
       * Place / move one OWNED gatherer's **work flag** to node (x,y) — the player's "work here" order
       * (the gathering twin of `moveUnit`). If the gatherer already carries a
       * {@link import('../../components/index.js').WorkFlag} its flag entity is relocated to (x,y) (only the
       * marker moves — goods already dropped stay pinned to their tiles); otherwise a fresh flag — a pure
       * {@link import('../../components/index.js').DeliveryFlag} marker with NO Stockpile (the harvest piles on
       * the GROUND around it, not into it) — is created there and bound with the default radius. From then on
       * the gatherer harvests only within that flag's radius, carries only what it dug, and banks its harvest
       * on the ground by the flag (see `planGatherer`).
       *
       * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale target, a
       * non-settler, a NEUTRAL (unowned) entity, or a settler whose job cannot harvest (a soldier has no
       * work flag). Carries no issuing-player yet (the per-player authority check lands with lockstep).
       * The app maps Ctrl+Right-Click with a gatherer selected to this. See `setWorkFlag`.
       */
      readonly kind: 'setWorkFlag';
      readonly entity: Entity;
      readonly x: number;
      readonly y: number;
    };
