import {
  AssistantRecruit,
  computerModuleRuns,
  MissionBehaviour,
  MissionObjectId,
  Rider,
  Settler,
  TrainingOrder,
  Weapon,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import { towerPostFor } from '../../conflict/tower-post.js';
import { attackerWeapon } from '../../conflict/weapons.js';
import type { SystemContext } from '../../context.js';
import { isRangedWeapon, isSoldierJob } from '../../readviews/index.js';
import { seatBarracksOf } from '../base.js';
import { minutesToTicks } from '../game-phase.js';
import { firstForecastAttackTick } from '../military/deadline.js';
import { WAVE_MIN_SOLDIERS } from '../military/muster.js';

/**
 * How long after the start the seat turns the soldiers it was placed with into builders (owner ruling: on
 * a map that hands a seat soldiers, everybody becomes a civilian at the start, more useful building than
 * fighting, and still defending as hunters and through the defensive mode). A game minute covers the
 * seat's first workforce decisions and an order a running action defers.
 */
export const DEMOBILIZE_UNTIL_TICK = minutesToTicks(1);

/**
 * A forecast scripted attack landing before this tick comes too early for the seat to raise a barracks and
 * drill an army first, so it keeps {@link START_CORE_SOLDIERS} armed (authored): on mroczny_las the first
 * wave lands at minute 25 on every seat, and a seat whose barracks stood only then (seed 7) met the waves
 * with no soldier and fell from 56 people to 20 by minute 45, where it had held with its start soldiers.
 */
export const EARLY_ATTACK_BEFORE_TICKS = minutesToTicks(30);

/** The start soldiers kept armed against an early attack: two of the smallest waves the campaign sends,
 *  the army floor's own smallest size, so the floor drafts nobody back on their account (authored). */
export const START_CORE_SOLDIERS = 2 * WAVE_MIN_SOLDIERS;

/**
 * The trade changes turning `player`'s start soldiers into builders, while the clock is inside {@link
 * DEMOBILIZE_UNTIL_TICK}: on a seat with no standing barracks, so it drafted none of them, whose military
 * module runs, so it drafts an army again, and whose AI no map program scripts, since that commands its
 * soldiers. Every owned soldier qualifies (a hero is no soldier) except vehicle crew, a tower's post, a
 * man in drill or booked, and one a map script addresses ({@link MissionObjectId}, {@link
 * MissionBehaviour}). Facing a forecast attack before {@link EARLY_ATTACK_BEFORE_TICKS}, the seat keeps
 * {@link START_CORE_SOLDIERS} of them armed, archers first (a bow holds the door from behind the houses),
 * then ascending id. The trade change disarms a man and his arms go to the stores. Nothing is saved: a
 * soldier is a builder after one order, and once the window closes the rule never fires again.
 */
export function demobilizeStartSoldiers(
  world: World,
  ctx: SystemContext,
  player: number,
  builderJob: number | null,
): readonly PlayerCommand[] {
  if (builderJob === null || ctx.tick >= DEMOBILIZE_UNTIL_TICK) return [];
  if (!computerModuleRuns(world, player, 'military') || mapScriptedSeat(ctx, player)) return [];
  if (seatBarracksOf(world, ctx, player) !== null) return [];
  const soldiers = ownedSettlers(world, player).filter((e) => isStartSoldier(world, ctx, e));
  const kept = earlyAttack(world, ctx, player) ? armedCore(world, ctx, soldiers) : NONE_KEPT;
  return soldiers
    .filter((e) => !kept.has(e))
    .map((entity): PlayerCommand => ({ kind: 'setJob', entity, jobType: builderJob }));
}

const NONE_KEPT: ReadonlySet<Entity> = new Set();

function earlyAttack(world: World, ctx: SystemContext, player: number): boolean {
  const attack = firstForecastAttackTick(world, ctx, player);
  return attack !== null && attack < EARLY_ATTACK_BEFORE_TICKS;
}

/** The {@link START_CORE_SOLDIERS} of `soldiers` (ascending id) the seat keeps armed: archers first. */
function armedCore(world: World, ctx: SystemContext, soldiers: readonly Entity[]): ReadonlySet<Entity> {
  const archers: Entity[] = [];
  const others: Entity[] = [];
  for (const e of soldiers) (shootsBow(world, ctx, e) ? archers : others).push(e);
  return new Set([...archers, ...others].slice(0, START_CORE_SOLDIERS));
}

function shootsBow(world: World, ctx: SystemContext, e: Entity): boolean {
  const settler = world.get(e, Settler);
  const armed = attackerWeapon(
    ctx,
    settler.tribe,
    settler.jobType,
    world.tryGet(e, Weapon)?.weaponTypeId,
    settler.humanForm,
  );
  return armed !== null && isRangedWeapon(armed.weapon);
}

function isStartSoldier(world: World, ctx: SystemContext, e: Entity): boolean {
  const { jobType } = world.get(e, Settler);
  if (!isSoldierJob(ctx.content, jobType) || jobType === null) return false;
  if (world.has(e, Rider) || world.has(e, TrainingOrder) || world.has(e, AssistantRecruit)) return false;
  if (world.has(e, MissionObjectId) || world.has(e, MissionBehaviour)) return false;
  return towerPostFor(world, ctx, e, jobType) === null;
}

function mapScriptedSeat(ctx: SystemContext, player: number): boolean {
  return ctx.mapAiScript?.some((row) => row.player === player) ?? false;
}
