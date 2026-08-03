import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { seatBarracksOf } from '../base.js';
import { campaignTarget, objectiveNode } from './campaign.js';
import { type ArmyCensus, weaponMix } from './census.js';
import { spokenFor } from './errand.js';
import { gatherAt, marchOrders, meleeCoreFor, musterAround, waveReady, waveWorthy } from './muster.js';

/**
 * One strategic decision for the seat's campaign: sort the free fighters around the barracks door
 * ({@link musterAround}), then roll for the launch. The men at the door leave on a win and march the whole
 * way under one attack focus; a body already nearer the objective goes in without a roll it has nowhere
 * safe to wait out; everybody else is called in.
 */
export function runOffensive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  army: ArmyCensus,
): Command[] {
  if (army.ready.length === 0 && army.awaitingWeapon.length === 0) return [];
  // No barracks, no rally point - and no army either, since its drill is the seat's only route to a
  // soldier (workforce/garrison.ts).
  const barracks = seatBarracksOf(world, ctx, player);
  if (barracks === null) return [];
  const home = interactionCell(world, ctx, terrain, barracks);
  const target = campaignTarget(world, ctx, terrain, player, home);
  if (target === null) return gatherAt(world, terrain, [...army.ready, ...army.awaitingWeapon], home);

  // Sorted over the men this decision may actually order, so a wave is never rolled at a strength the
  // march cannot fill. A man in transit sits out one decision and is read again once he arrives.
  const free = army.ready.filter((e) => !spokenFor(world, e));
  const objective = objectiveNode(world, ctx, terrain, target);
  const { formed, forward, homing } = musterAround(world, terrain, free, home, objective);
  // Measured over the whole army, so a seat that owns a front rank is not benched for one still walking in.
  const core = meleeCoreFor(weaponMix(world, ctx, army.ready));
  const charges = waveReady(ctx, weaponMix(world, ctx, formed), core);
  // Forward men go in with a launching wave or as a band of their own; too few for either and they come
  // home, since the size floor governs who the seat sends anywhere, not where the last fight left him.
  const pressOn = charges || waveWorthy(weaponMix(world, ctx, forward), core);

  const marching: Entity[] = [];
  const waiting: Entity[] = [];
  (charges ? marching : waiting).push(...formed);
  (pressOn ? marching : waiting).push(...forward);
  waiting.push(...homing, ...army.awaitingWeapon);
  return [...marchOrders(world, marching, target), ...gatherAt(world, terrain, waiting, home)];
}
