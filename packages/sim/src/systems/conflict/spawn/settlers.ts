import type { ContentSet } from '@open-northland/data';
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
 * The hitpoint pool a settler spawns with when its command names none. Every human carries a {@link Health}
 * pool (user decision: civilians have health too — the panel shows it, a soldier can strike them, starvation
 * drains it). The magnitude is approximated — a human's hitpoints are below the readable `.ini` (source basis
 * "Combat hit resolution"); 300 is the sandbox scale the combat scenes and admin palette already use.
 */
export const DEFAULT_SETTLER_HITPOINTS = 300;

/**
 * Assemble a settler entity from a {@link SettlerSpec} and return it (or null for an unknown job id — bad
 * input, no entity created). The pure entity-construction core shared by the `spawnSettler` command handler
 * (which then announces `settlerBorn`) and the sanctioned pre-tick-0 scene helpers (which create authored
 * fixture state directly, like {@link createResourceNode}, and stamp their own bindings on the returned
 * entity — e.g. a gatherer's {@link WorkFlag}). It emits no event and takes `content` (not a full
 * `SystemContext`), matching {@link createResourceNode}: the birth event belongs to the runtime seam only.
 *
 * Stamp set and order are hash-significant — keep them stable. Each optional stamp follows the
 * separate-optional-component pattern: absent input leaves the component off and the golden hash untouched.
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
  // Every settler carries a `Health` pool: a command with positive `hitpoints` sets it, one without gets
  // {@link DEFAULT_SETTLER_HITPOINTS}.
  const hitpoints =
    spec.hitpoints !== undefined && spec.hitpoints > 0 ? spec.hitpoints : DEFAULT_SETTLER_HITPOINTS;
  world.add(e, Health, { hitpoints, max: hitpoints });
  // A combatant wearing armor carries an `Armor` class: an incoming hit is mitigated by that tier's
  // `blockingValue` rather than landing on the unarmored class 0. Only a positive class is stamped.
  if (spec.armorClass !== undefined && spec.armorClass > 0) {
    world.add(e, Armor, { armorClass: spec.armorClass });
  }
  // A combatant with a specific weapon carries a `Weapon{weaponTypeId}`: the CombatSystem resolves its attack
  // through that weapon instead of the default `(tribe, jobType)` first-match. Only a positive id is stamped.
  if (spec.weaponTypeId !== undefined && spec.weaponTypeId > 0) {
    world.add(e, Weapon, { weaponTypeId: spec.weaponTypeId });
  }
  // The player-facing inventory (boots/tool/consumables + a soldier's weapon/armour) the selection panel shows,
  // independent of the combat `Weapon`/`Armor` above. `!= null` (not `!== undefined`) because a command is the
  // serialize/replay/lockstep wire format, where an explicit `null` also means "no equipment".
  if (spec.equipment != null) {
    world.add(e, Equipment, equipmentFromCommand(spec.equipment));
  }
  // An explicit walk pace: `perTick = ONE/moveSpeed` (ticks-per-tile, larger = slower), read by the same
  // drift-free arrival-snap as the universal default. Only a positive value is stamped; absent walks at
  // MOVE_SPEED_PER_TICK.
  if (spec.moveSpeed !== undefined && spec.moveSpeed > 0) {
    world.add(e, MoveSpeed, { perTick: fx.div(ONE, fx.fromInt(spec.moveSpeed)) });
  }
  // A settler spawned for a specific player carries an `Owner` — the human player's to select and order.
  // Omitted / out-of-range leaves it neutral.
  stampOwner(world, e, spec.owner);
  // An owned settler also gets its job's default military stance (soldiers→ATTACK, scout/hunter→IGNORE, other
  // civilians→FLEE); the player overrides with `setStance`. Owned-only (gated on Owner), so an unowned/golden
  // settler carries no Stance.
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
  // spawn-time twin of the profession-change auto-plant, `syncWorkFlagToJob`), so it only searches its flag's
  // radius, not the whole map. A non-gathering trade gets no flag. Source basis: a design rule (user-specified),
  // approximating the original's observed collector-flag work-area model; the not-yet-wired half (a
  // building-assigned gatherer delivering to its building) is tracked in
  // docs/tickets/sim/building-assigned-gatherers.md.
  syncWorkFlagToJob(world, ctx, e, command.jobType);
  ctx.events.emit({ kind: 'settlerBorn', entity: e });
}

/** One command equipment slot → the component's {@link EquipmentSlot} (or null for an empty slot). The raw
 *  `degreeOfUsePct` (0..100) becomes the `Fixed` fraction `degreeOfUse`. */
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
