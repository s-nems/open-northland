import {
  AssistantRecruit,
  computerModuleRuns,
  MissionBehaviour,
  MissionObjectId,
  Rider,
  Settler,
  TrainingOrder,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import { towerPostFor } from '../../conflict/tower-post.js';
import type { SystemContext } from '../../context.js';
import { isSoldierJob } from '../../readviews/index.js';
import { seatBarracksOf } from '../base.js';
import { minutesToTicks } from '../game-phase.js';

/**
 * How long after the start the seat turns the soldiers it was placed with into builders (owner ruling: on
 * a map that hands a seat soldiers, everybody becomes a civilian at the start, more useful building than
 * fighting, and still defending as hunters and through the defensive mode). A game minute covers the
 * seat's first workforce decisions and an order a running action defers.
 */
export const DEMOBILIZE_UNTIL_TICK = minutesToTicks(1);

/**
 * The trade changes turning `player`'s start soldiers into builders, while the clock is inside {@link
 * DEMOBILIZE_UNTIL_TICK}: on a seat with no standing barracks, so it drafted none of them, whose military
 * module runs, so it drafts an army again, and whose AI no map program scripts, since that commands its
 * soldiers. Every owned soldier qualifies (a hero is no soldier) except vehicle crew, a tower's post, a
 * man in drill or booked, and one a map script addresses ({@link MissionObjectId}, {@link
 * MissionBehaviour}). The trade change disarms a man and his arms go to the stores. Nothing is saved: a
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
  return homeSettlers(world, ctx, player)
    .filter((e) => isStartSoldier(world, ctx, e))
    .map((entity): PlayerCommand => ({ kind: 'setJob', entity, jobType: builderJob }));
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
