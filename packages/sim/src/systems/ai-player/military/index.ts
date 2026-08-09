import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import type { AiPlayerModule } from '../index.js';
import { ownedBuildings } from '../seat-roster.js';
import { takeCensus } from './census.js';
import {
  alarmOrders,
  raidOnTheSettlement,
  seatRaiders,
  sortieOrders,
  towerPostOrders,
} from './defence/index.js';
import { runOffensive } from './offensive.js';

export { campaignTarget } from './campaign.js';
export { type ArmyCensus, takeCensus, type WeaponMix, weaponMix } from './census.js';
export {
  THREAT_STAND_DOWN_MARGIN_NODES,
  TOWER_GARRISON_ARCHERS,
  threatWatchNodes,
} from './defence/index.js';
export { RALLY_HOLD_RADIUS_NODES, WAVE_FULL_SOLDIERS, WAVE_MIN_SOLDIERS } from './muster.js';

/**
 * One strategic decision for the seat's fighting men, home before abroad: the towers take their garrison
 * ({@link TOWER_GARRISON_ARCHERS}) out of the free band, a raid at the gates takes the rest of it, and the
 * campaign gets what neither claimed.
 *
 * Defence has no module flag of its own because the module list mirrors the original's `HAI_Disable*` map
 * flags, which name no defence toggle.
 */
function runMilitary(world: World, ctx: SystemContext, player: number): readonly PlayerCommand[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // mapless sim: no ground to march over
  const owned = ownedBuildings(world, player);
  const army = takeCensus(world, ctx, player);
  const posts = towerPostOrders(world, ctx, terrain, owned, army.ready);
  const free = army.ready.filter((e) => !posts.claimed.has(e));
  const raiders = seatRaiders(world, ctx, terrain, player);
  const raid = raidOnTheSettlement(world, ctx, terrain, owned, raiders);
  // A raid benches the campaign: it takes the same band the muster would have gathered.
  const marchable: readonly Entity[] = raid === null ? free : [];
  return [
    ...alarmOrders(world, ctx, terrain, owned, raiders),
    ...posts.commands,
    ...(raid === null ? [] : sortieOrders(world, terrain, free, raid)),
    ...runOffensive(world, ctx, terrain, player, { army: marchable, awaitingWeapon: army.awaitingWeapon }),
  ];
}

export const militaryModule: AiPlayerModule = {
  id: 'military',
  run: runMilitary,
};
