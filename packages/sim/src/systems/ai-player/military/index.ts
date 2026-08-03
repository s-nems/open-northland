import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import type { AiPlayerModule } from '../index.js';
import { ownedBuildings } from '../shared.js';
import { takeCensus } from './census.js';
import {
  alarmOrders,
  raidOnTheSettlement,
  seatRaiders,
  sortieOrders,
  towerPostOrders,
} from './defence/index.js';
import { runOffensive } from './offensive.js';

export { campaignTarget, objectiveNode } from './campaign.js';
export { type ArmyCensus, takeCensus, type WeaponMix, weaponMix } from './census.js';
export {
  THREAT_STAND_DOWN_MARGIN_NODES,
  TOWER_GARRISON_ARCHERS,
  threatWatchNodes,
} from './defence/index.js';
export {
  type Muster,
  meleeCoreFor,
  musterAround,
  RALLY_HOLD_RADIUS_NODES,
  STAGING_STANDOFF_NODES,
  stagingNode,
  WAVE_FULL_SOLDIERS,
  WAVE_MELEE_CORE,
  WAVE_MIN_SOLDIERS,
} from './muster.js';

// The Military module - the seat's army: who holds its walls, who answers a raid at home, and what the
// rest march on. Every rule here comes from the user, not the data.

/**
 * One strategic decision for the seat's fighting men, home before abroad: the towers take their garrison
 * ({@link TOWER_GARRISON_ARCHERS}) out of the free band, a raid at the gates takes the whole rest of it,
 * and only what neither claimed is left to the campaign.
 *
 * The alarm rides along with all of this rather than under a flag of its own: the module list mirrors the
 * original's `HAI_Disable*` map flags, which name no defence toggle, and `HAI_DisableMilitary` is the one
 * that means "this seat does not fight".
 */
function runMilitary(world: World, ctx: SystemContext, player: number): readonly Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // mapless sim: no ground to march over
  const owned = ownedBuildings(world, player);
  const army = takeCensus(world, ctx, player);
  const posts = towerPostOrders(world, ctx, terrain, owned, army.ready);
  const free = army.ready.filter((e) => !posts.claimed.has(e));
  const raiders = seatRaiders(world, ctx, terrain, player);
  const raid = raidOnTheSettlement(world, ctx, terrain, owned, raiders);
  // A raid benches the campaign: the band it takes is the band the muster would have gathered, and the
  // recruits still waiting on a weapon are called home either way.
  const marchable: readonly Entity[] = raid === null ? free : [];
  return [
    ...alarmOrders(world, ctx, terrain, owned, raiders),
    ...posts.commands,
    ...(raid === null ? [] : sortieOrders(world, terrain, free, raid)),
    ...runOffensive(world, ctx, terrain, player, { ...army, ready: marchable }),
  ];
}

export const militaryModule: AiPlayerModule = {
  id: 'military',
  run: runMilitary,
};
