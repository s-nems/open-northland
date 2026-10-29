import type { ContentSet, WeaponType } from '@open-northland/data';
import { Health, Person, Settler, Weapon } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { attackerWeapon, targetBlocking, targetMaterial } from '../../conflict/weapons.js';
import type { SystemContext } from '../../context.js';
import { carriedCombatEffects, healingReserveOf } from '../../equipment/effects.js';
import { HUMAN_HITPOINTS } from '../../lifecycle/unit-health.js';
import { ownedFightersOf } from '../../movement/collision/owned-fighters.js';
import { ARMOR_MATERIAL, WEAPON_MAIN_TYPE, weaponDamageVsMaterial } from '../../readviews/index.js';

// A fighter's combat value in points, derived from content (owner ruling: strength counts each visible
// unit by its weapon and its armour). Attack: the weapon's damage averaged over the armour columns a
// soldier can wear. Survival: his hitpoints over the damage he takes per blow, averaged over every
// soldier's weapon, after his armour's blocking. Points are attack times survival, the duel value a
// square law weighs. Approximation: blind to swing speed, reach, experience and the hit direction.

/** The armour columns a weapon's attack is averaged over, equally: bare and the four base armours. */
const REFERENCE_ARMOUR_MATERIALS: readonly number[] = [
  ARMOR_MATERIAL.NONE,
  ARMOR_MATERIAL.WOOL,
  ARMOR_MATERIAL.LEATHER,
  ARMOR_MATERIAL.CHAIN,
  ARMOR_MATERIAL.PLATE,
];

/** Weapon classes left out of the reference mix a man's survival is weighed against: fists and siege. */
const NON_SOLDIER_CLASSES: ReadonlySet<number> = new Set([
  WEAPON_MAIN_TYPE.NONE,
  WEAPON_MAIN_TYPE.UNARMED,
  WEAPON_MAIN_TYPE.CATAPULT,
]);

/** Scales attack times survival into points (authored): a bare man with a viking short sword at full
 *  hitpoints scores about 15, one in chain with a long sword about 120. */
export const POINTS_DIVISOR = 100;

const PERCENT = 100;

/** What a fighter carries beyond his weapon and armour, each read off the unit where the sim exposes it. */
export interface FighterBuffs {
  /** Percent of its damage a blow deals: the strength amulet, and the critical-hit amulet's expected share. */
  readonly dealtPct: number;
  /** Percent of a blow's damage he takes: the defence amulet. */
  readonly takenPct: number;
  /** His hitpoints now, a temple's blessing above the max included, plus his healing potions' reserve. */
  readonly hitpoints: number;
}

/** A fresh man at the human pool with nothing carried. */
export const UNBUFFED: FighterBuffs = { dealtPct: PERCENT, takenPct: PERCENT, hitpoints: HUMAN_HITPOINTS };

interface PointsTable {
  readonly reference: readonly WeaponType[];
  readonly attack: Map<WeaponType, number>;
  /** By `material * BLOCKING_KEY_SPAN + blocking`. */
  readonly taken: Map<number, number>;
}

/** Packs a blocking value beside its material; content blocking values sit far below it. */
const BLOCKING_KEY_SPAN = 1 << 16;

const tables = new WeakMap<ContentSet, PointsTable>();

function tableOf(content: ContentSet): PointsTable {
  let table = tables.get(content);
  if (table === undefined) {
    const soldiers = content.weapons.filter(
      (w) => w.goodType !== undefined && (w.mainType === undefined || !NON_SOLDIER_CLASSES.has(w.mainType)),
    );
    table = {
      reference: soldiers.length > 0 ? soldiers : content.weapons,
      attack: new Map(),
      taken: new Map(),
    };
    tables.set(content, table);
  }
  return table;
}

/** `weapon`'s damage per blow averaged over {@link REFERENCE_ARMOUR_MATERIALS}. Memoized per content. */
export function weaponAttackScore(content: ContentSet, weapon: WeaponType): number {
  const table = tableOf(content);
  const held = table.attack.get(weapon);
  if (held !== undefined) return held;
  let sum = 0;
  for (const material of REFERENCE_ARMOUR_MATERIALS) sum += weaponDamageVsMaterial(weapon, material);
  const score = Math.floor(sum / REFERENCE_ARMOUR_MATERIALS.length);
  table.attack.set(weapon, score);
  return score;
}

/** The damage per blow a man of armour `material` and `blocking` takes, averaged over every soldier's
 *  weapon in the content, at least 1. Memoized per content. */
export function armourTakenScore(content: ContentSet, material: number, blocking: number): number {
  const table = tableOf(content);
  const key = material * BLOCKING_KEY_SPAN + blocking;
  const held = table.taken.get(key);
  if (held !== undefined) return held;
  let sum = 0;
  for (const weapon of table.reference)
    sum += Math.max(0, weaponDamageVsMaterial(weapon, material) - blocking);
  const score = Math.max(1, Math.floor(sum / Math.max(1, table.reference.length)));
  table.taken.set(key, score);
  return score;
}

/** One fighter's points, at least 1 for any live man so a body of fist fighters still weighs. */
export function fighterPoints(
  content: ContentSet,
  weapon: WeaponType | null,
  material: number,
  blocking: number,
  buffs: FighterBuffs = UNBUFFED,
): number {
  const attack = weapon === null ? 0 : weaponAttackScore(content, weapon);
  const taken = armourTakenScore(content, material, blocking) * Math.max(1, buffs.takenPct);
  return Math.max(1, Math.floor((attack * buffs.dealtPct * buffs.hitpoints) / (taken * POINTS_DIVISOR)));
}

/** What `e` carries into a fight: his amulets, his hitpoints now and his healing potions. */
export function fighterBuffsOf(world: World, content: ContentSet, e: Entity): FighterBuffs {
  const effects = carriedCombatEffects(world, content, e);
  let dealtPct = effects.damageDealtPct ?? PERCENT;
  const critical = effects.criticalHit;
  if (critical !== undefined) {
    dealtPct = Math.floor(
      (dealtPct * (PERCENT * PERCENT + critical.chancePct * (critical.damagePct - PERCENT))) /
        (PERCENT * PERCENT),
    );
  }
  const health = world.tryGet(e, Health);
  const hitpoints =
    health === undefined
      ? HUMAN_HITPOINTS
      : health.hitpoints + healingReserveOf(world, content, e, health.max);
  return { dealtPct, takenPct: effects.damageTakenPct ?? PERCENT, hitpoints };
}

/** A live fighter's points as anyone who sees him can read them: weapon, armour, amulets, hitpoints. */
export function unitPoints(world: World, ctx: SystemContext, e: Entity): number {
  const settler = world.get(e, Settler);
  const armed = attackerWeapon(
    ctx,
    settler.tribe,
    settler.jobType,
    world.tryGet(e, Weapon)?.weaponTypeId,
    settler.humanForm,
  );
  return fighterPoints(
    ctx.content,
    armed?.weapon ?? null,
    targetMaterial(world, ctx, e),
    targetBlocking(world, ctx, e),
    fighterBuffsOf(world, ctx.content, e),
  );
}

/** Whether a sighted `e` counts in an army: a person with hitpoints left. */
export function isLiveFighter(world: World, e: Entity): boolean {
  return world.has(e, Person) && hasHitpoints(world, e);
}

/** A fighter at zero hitpoints is a body awaiting removal, not a man. */
function hasHitpoints(world: World, e: Entity): boolean {
  return (world.tryGet(e, Health)?.hitpoints ?? 0) > 0;
}

/** A body of fighters: its head count and its points. */
export interface ArmyPoints {
  readonly men: number;
  readonly points: number;
}

/**
 * `player`'s live fighters and their points, tower garrisons and men aboard a vehicle included, each man holding a post weighed
 * `postedWeight` times (`isPosted`). The live read, blind to the fog. Costs `player`'s fighters.
 */
export function armyPointsOf(
  world: World,
  ctx: SystemContext,
  player: number,
  postedWeight: number,
  isPosted: (e: Entity) => boolean,
): ArmyPoints {
  let men = 0;
  let points = 0;
  for (const e of ownedFightersOf(world, ctx.content, player)) {
    if (!hasHitpoints(world, e)) continue;
    men++;
    const value = unitPoints(world, ctx, e);
    points += postedWeight !== 1 && isPosted(e) ? value * postedWeight : value;
  }
  return { men, points };
}
