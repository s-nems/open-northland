import type { ContentSet } from '@vinland/data';
import {
  Armor,
  Equipment,
  type EquipmentSlot,
  Health,
  MISC_EQUIP_SLOTS,
  MoveSpeed,
  Owner,
  Position,
  Settler,
  stampOwner,
  Weapon,
} from '../../../components/index.js';
import type { Command, SettlerEquipment, SettlerEquipmentSlot } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { fx, ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import { positionOfNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { syncWorkFlagToJob } from '../../economy/flags.js';
import { stampDefaultStance } from '../../orders/index.js';

/**
 * The DATA of a settler to create — the {@link Command} `spawnSettler` payload minus its `kind`, so a
 * scene's direct pre-tick-0 placement and the runtime command share the one entity-assembly path (the
 * settler analogue of {@link createResourceNode}'s {@link ResourceNodeSpec}). `x`/`y` are half-cell node
 * coords, like every sim command.
 */
export type SettlerSpec = Omit<Extract<Command, { kind: 'spawnSettler' }>, 'kind'>;

/**
 * The hitpoint pool a settler spawns with when its command names none — every human carries a
 * {@link Health} pool (user decision 2026-07-11: civilians have health too — the panel shows it, a
 * soldier can strike them, starvation drains it). The MAGNITUDE is approximated: a human's hitpoints
 * are below the readable `.ini` (source basis "Combat hit resolution"); 300 is the sandbox scale the
 * combat scenes and the admin palette already used.
 */
export const DEFAULT_SETTLER_HITPOINTS = 300;

/**
 * Assemble a settler entity from a {@link SettlerSpec} and return it (or null for an unknown job id — bad
 * input, no entity created). This is the pure entity-construction core shared by the `spawnSettler` COMMAND
 * handler (which then announces `settlerBorn`) and the sanctioned pre-tick-0 scene helpers (which create
 * authored fixture state directly, like {@link createResourceNode}, and stamp their own bindings on the
 * returned entity — e.g. a gatherer's {@link WorkFlag}). It emits NO event and takes `content` (not a full
 * `SystemContext`), matching {@link createResourceNode}: the birth event belongs to the runtime seam only.
 *
 * The component-stamp set + ORDER is identical to the prior inline handler, so a command-spawned settler
 * hashes byte-for-byte as before (the golden slice is untouched). Each optional stamp is the
 * separate-optional-component pattern: absent input leaves the component off and the hash untouched.
 */
export function createSettler(world: World, content: ContentSet, spec: SettlerSpec): Entity | null {
  // jobType 0 ("idle"/unemployed) is allowed; only an id absent from the job table is bad input.
  if (!contentIndex(content).commandJobs.has(spec.jobType)) return null;

  const e = world.create();
  world.add(e, Position, positionOfNode(spec.x, spec.y));
  world.add(e, Settler, {
    tribe: spec.tribe,
    jobType: spec.jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  // EVERY settler carries a `Health` pool (the settler analogue of the animal `hitpoints_adult` stamp):
  // a command with a positive `hitpoints` sets the pool (a scene's tuned combatant), one without gets
  // {@link DEFAULT_SETTLER_HITPOINTS} — civilians have health too (they show a Zdrowie bar, a soldier
  // can strike them, starvation drains them; user decision 2026-07-11). The MAGNITUDE is approximated —
  // a human's hitpoints are below the readable `.ini` (source basis "Combat hit resolution").
  const hitpoints =
    spec.hitpoints !== undefined && spec.hitpoints > 0 ? spec.hitpoints : DEFAULT_SETTLER_HITPOINTS;
  world.add(e, Health, { hitpoints, max: hitpoints });
  // A combatant wearing armor carries an `Armor` class (the settler analogue of the `Health` stamp): an
  // incoming hit is mitigated by that tier's `blockingValue` rather than landing on the unarmored class 0.
  // Only a positive class is stamped; absent / non-positive `armorClass` (the default) leaves the settler
  // unarmored, the separate-optional-component pattern that keeps the golden hash untouched.
  if (spec.armorClass !== undefined && spec.armorClass > 0) {
    world.add(e, Armor, { armorClass: spec.armorClass });
  }
  // A combatant equipped with a specific weapon carries a `Weapon{weaponTypeId}` (the same separate-optional
  // stamp): the CombatSystem then resolves its attack through THAT weapon (vs the settler's own tribe)
  // instead of the default `(tribe, jobType)` first-match. Only a positive id is stamped; absent / non-positive
  // `weaponTypeId` (the default) leaves the settler with its class's default weapon and the hash untouched.
  if (spec.weaponTypeId !== undefined && spec.weaponTypeId > 0) {
    world.add(e, Weapon, { weaponTypeId: spec.weaponTypeId });
  }
  // A settler wearing equipment carries an `Equipment` component (the same separate-optional stamp): the
  // player-facing inventory (boots/tool/consumables + a soldier's weapon/armour) the selection panel
  // shows. Only stamped when the command supplies it; absent (the default) leaves the settler
  // equipment-less and the hash untouched. Independent of the combat `Weapon`/`Armor` above. `!= null`
  // (not `!== undefined`) because a command is the serialize/replay/lockstep wire format, where an
  // explicit `null` can stand in for "no equipment" — both skip the stamp rather than dereferencing it.
  if (spec.equipment != null) {
    world.add(e, Equipment, equipmentFromCommand(spec.equipment));
  }
  // A settler given an explicit walk pace carries a `MoveSpeed` (the same separate-optional stamp as the
  // animal `movespeed`): `perTick = ONE/moveSpeed` (ticks-per-tile, larger = slower), read identically to
  // the universal default by the drift-free arrival-snap so two runs stay byte-identical. Only a positive
  // value is stamped; absent / non-positive (the default — the golden / vertical-slice path) leaves the
  // settler `MoveSpeed`-less, walking at MOVE_SPEED_PER_TICK, the hash untouched. `runPerTick` is null — a
  // settler has no decoded run gait, and the MovementSystem reads only `perTick`.
  if (spec.moveSpeed !== undefined && spec.moveSpeed > 0) {
    world.add(e, MoveSpeed, {
      perTick: fx.div(ONE, fx.fromInt(spec.moveSpeed)),
      runPerTick: null,
    });
  }
  // A settler spawned for a specific PLAYER carries an `Owner` (the same separate-optional stamp): it
  // is the human player's to select and order. Omitted / out-of-range owner leaves it neutral (the
  // golden / vertical-slice path), hash untouched.
  stampOwner(world, e, spec.owner);
  // An OWNED settler also gets its job's default military stance (soldiers→ATTACK, scout/hunter→IGNORE,
  // every other civilian→FLEE — the `defaultStanceForJob` table); the player overrides it with
  // `setStance` later. Owned-ONLY (gated on the stamped Owner): a neutral/wildlife/golden settler carries
  // NO Stance, so the military-mode feature leaves every unowned entity — and every golden hash — untouched.
  if (world.has(e, Owner)) stampDefaultStance(world, e, spec.jobType);
  return e;
}

/**
 * The `spawnSettler` COMMAND handler: create a {@link Settler} from the command payload
 * ({@link createSettler}) and, when one was made, announce `settlerBorn` for render/audio. An unknown job
 * id is bad input — no entity, no event (still logged by commandSystem, so replay stays faithful).
 */
export function spawnSettler(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'spawnSettler' }>,
): void {
  const e = createSettler(world, ctx.content, command);
  if (e === null) return;
  // A gatherer is never "free": bind it to a work flag planted at its feet the moment it is born (the
  // spawn-time twin of the profession-change auto-plant, `syncWorkFlagToJob`), so it only ever searches
  // its flag's radius, not the whole map. A non-gathering trade gets no flag. This is what makes an
  // imported map's / admin-spawned gatherer flag-bound like a sandbox one — before it, a command-spawned
  // gatherer was unbound and roamed the entire map for the nearest resource. Source basis: a DESIGN
  // RULE (user-specified), approximating the original's observed collector-flag work-area model; the
  // not-yet-wired half — a building-assigned gatherer with no flag delivering to its building — is
  // tracked in docs/tickets/sim/building-assigned-gatherers.md.
  syncWorkFlagToJob(world, ctx, e, command.jobType);
  ctx.events.emit({ kind: 'settlerBorn', entity: e });
}

/** One command equipment slot → the component's {@link EquipmentSlot} (or null for an empty slot). The
 *  raw `degreeOfUsePct` (0..100) becomes the `Fixed` fraction `degreeOfUse` — the same raw-int→`Fixed`
 *  conversion `moveSpeed` uses, deterministic (integer arithmetic, no RNG/wall-clock). */
function toEquipmentSlot(input: SettlerEquipmentSlot | null | undefined): EquipmentSlot | null {
  if (input === null || input === undefined) return null;
  const pct = Math.max(0, Math.min(100, Math.trunc(input.degreeOfUsePct ?? 0)));
  return { goodType: input.goodType, degreeOfUse: fx.div(fx.fromInt(pct), fx.fromInt(100)) };
}

/** Build the {@link Equipment} component value from a command payload — the `misc` list is normalised to
 *  the fixed {@link MISC_EQUIP_SLOTS} length (excess dropped, short padded with empty slots). */
function equipmentFromCommand(equipment: SettlerEquipment): {
  boots: EquipmentSlot | null;
  tool: EquipmentSlot | null;
  weapon: EquipmentSlot | null;
  armor: EquipmentSlot | null;
  misc: ReadonlyArray<EquipmentSlot | null>;
} {
  const misc: (EquipmentSlot | null)[] = [];
  for (let i = 0; i < MISC_EQUIP_SLOTS; i++) misc.push(toEquipmentSlot(equipment.misc?.[i]));
  return {
    boots: toEquipmentSlot(equipment.boots),
    tool: toEquipmentSlot(equipment.tool),
    weapon: toEquipmentSlot(equipment.weapon),
    armor: toEquipmentSlot(equipment.armor),
    misc,
  };
}
