import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import type { AiPlayerModule } from '../index.js';
import { ownedBuildings } from '../seat-roster.js';
import { takeCensus } from './census.js';
import {
  alarmOrders,
  enlistOrders,
  raidOnTheSettlement,
  seatRaiders,
  sortieOrders,
  towerPostOrders,
} from './defence/index.js';
import { runOffensive } from './offensive.js';
import { outfitOrders } from './outfit.js';

export { campaignTarget } from './campaign.js';
export { type ArmyCensus, takeCensus, type WeaponMix, weaponMix } from './census.js';
export {
  THREAT_STAND_DOWN_MARGIN_NODES,
  TOWER_GARRISON_ARCHERS,
  threatWatchNodes,
  towerPostOrders,
} from './defence/index.js';
export { ASSAULT_RING_RADIUS_NODES, RALLY_HOLD_RADIUS_NODES, WAVE_MIN_SOLDIERS } from './muster.js';
export { SOLDIER_OUTFIT_GOOD_IDS } from './outfit.js';
export { LATE_WAVE, OPENING_WAVE, WAVE_GATHER_TICKS, WAVE_RAMP_TICKS, waveBandAt } from './plan.js';

/**
 * One decision for the seat's fighting men, home before abroad: the free fighters are enlisted, the
 * towers take their garrison ({@link TOWER_GARRISON_ARCHERS}) out of the free band, a raid at the gates
 * takes the rest of it, and the campaign gets what neither claimed. A man the campaign leaves waiting at
 * the barracks is sent for his outfit.
 *
 * The home half runs with the module off too: the original's scripted handler, which the `HAI_Disable`
 * toggles do not reach, lists the soldiers, mans the towers and answers an attack (original behavior). The
 * shape and radii of the defence here are approximations. The home half also runs for a seat whose scripted
 * handler is off while the module is on, a pairing no map produces: `AI_Disable` switches the modules off
 * with the handler.
 */
function runMilitary(
  world: World,
  ctx: SystemContext,
  player: number,
  campaign: boolean,
): readonly PlayerCommand[] {
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
  const offensive = campaign
    ? runOffensive(world, ctx, terrain, player, { army: marchable, awaitingWeapon: army.awaitingWeapon })
    : null;
  return [
    ...enlistOrders(world, ctx, player),
    ...alarmOrders(world, ctx, terrain, owned, raiders),
    ...posts.commands,
    ...(raid === null ? [] : sortieOrders(world, terrain, free, raid)),
    ...(offensive?.commands ?? []),
    ...outfitOrders(world, ctx, terrain, player, offensive?.waiting ?? []),
  ];
}

export const militaryModule: AiPlayerModule = {
  id: 'military',
  run: (world, ctx, player) => runMilitary(world, ctx, player, true),
  whileDisabled: (world, ctx, player) => runMilitary(world, ctx, player, false),
};
