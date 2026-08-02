import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isBarracks } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import type { AiPlayerModule } from '../index.js';
import { ownedBuildings } from '../shared.js';
import { campaignTarget } from './campaign.js';
import { takeCensus } from './census.js';
import { holdMuster, marchOrders, waveReady } from './muster.js';

export { campaignTarget } from './campaign.js';
export { type ArmyCensus, takeCensus } from './census.js';
export {
  MUSTER_HOME_RADIUS_NODES,
  RALLY_HOLD_RADIUS_NODES,
  WAVE_LAUNCH_SPREAD,
  WAVE_MELEE_CORE,
  WAVE_MIN_SOLDIERS,
} from './muster.js';

// The Military module - the seat's army. Its two standing rules come from the user, not the data: the
// muster always gathers at the barracks, and a wave that outlives its objective is re-aimed at the next
// one rather than recalled.

function runMilitary(world: World, ctx: SystemContext, player: number): readonly Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // mapless sim: no ground to march over
  // The barracks is the seat's military seat: with none there is no rally point - and no army either,
  // since its drill is the seat's only route to a soldier (workforce/garrison.ts).
  const barracks = barracksOf(world, ctx, player);
  if (barracks === null) return [];
  const rally = interactionCell(world, ctx, terrain, barracks);
  const army = takeCensus(world, ctx, terrain, player, rally);
  if (army.muster.length === 0 && army.afield.length === 0) return []; // nobody to command
  const target = campaignTarget(world, ctx, terrain, player, rally);
  if (target === null) return holdMuster(world, terrain, army, rally); // nothing left to march on
  const commands = marchOrders(world, army.afield, target);
  if (waveReady(ctx, army)) commands.push(...marchOrders(world, army.muster, target));
  else commands.push(...holdMuster(world, terrain, army, rally));
  return commands;
}

/** The seat's canonical barracks: its lowest-id owned STANDING one, or null when it has none. A
 *  canonical pick, not the nearest, so every wave forms up at one house. */
function barracksOf(world: World, ctx: SystemContext, player: number): Entity | null {
  for (const e of ownedBuildings(world, player)) {
    if (isBarracks(world, ctx, e)) return e;
  }
  return null;
}

export const militaryModule: AiPlayerModule = {
  id: 'military',
  run: runMilitary,
};
