import { Vehicle, vehicleCommander } from '../../../components/index.js';
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

import { marchingWave } from './march/index.js';
import { runOffensive } from './offensive.js';
import { outfitOrders } from './outfit.js';
import { siegeCrewOrders } from './siege-crew.js';

export { campaignTarget } from './campaign.js';
export {
  type ArmyCensus,
  fighterWeaponClass,
  TOWER_POST_STRENGTH,
  takeCensus,
  type WeaponMix,
  weaponMix,
} from './census.js';
export {
  enemyFire,
  THREAT_STAND_DOWN_MARGIN_NODES,
  TOWER_GARRISON_ARCHERS,
  threatWatchNodes,
  towerPostOrders,
} from './defence/index.js';
export {
  CATAPULT_REGROUP_SLACK_NODES,
  CHARGE_ARMY_DIVISOR,
  CHARGE_MIN_ENEMIES,
  CHARGE_RADIUS_NODES,
  FIGHT_HOLD_TIMEOUT_TICKS,
  LEG_NODES,
  LEG_TIMEOUT_TICKS,
  RANKS_BEHIND_CATAPULTS_NODES,
  REGROUP_SLACK_NODES,
  SIEGE_MARCH_MIN_CATAPULTS,
  SIEGE_STANDOFF_NODES,
  SIEGE_TIMEOUT_TICKS,
  SIEGE_TOWER_RADIUS_NODES,
  SIEGE_TOWER_STANDOFF_NODES,
} from './march/index.js';
export {
  ASSAULT_RING_RADIUS_NODES,
  RALLY_HOLD_RADIUS_NODES,
  rallyAt,
  WAVE_MIN_SOLDIERS,
} from './muster.js';
export { SOLDIER_OUTFIT_GOOD_IDS } from './outfit.js';
export {
  ARMY_CAP_SOLDIERS,
  LATE_WAVE,
  OPENING_WAVE,
  WAVE_GATHER_TICKS,
  WAVE_RAMP_TICKS,
  waveBandAt,
} from './plan.js';
export {
  type CrewedCatapult,
  crewedCatapults,
  PARK_RING_MAX_NODES,
  PARK_RING_MIN_NODES,
  PARK_SPACING_NODES,
  parkingOrders,
  seatCatapults,
} from './siege-crew.js';

/**
 * One decision for the seat's fighting men, home before abroad: the free fighters are enlisted, the
 * towers take their garrison ({@link TOWER_GARRISON_ARCHERS}) out of the free band, a raid at the gates
 * takes the rest of it, the catapults take their drivers, and the campaign gets what is left. A man the
 * campaign leaves waiting at the barracks, or a driver parked at home while no raid stands, is sent for his
 * outfit; the errand takes a driver off his catapult, which drafts another. The men and catapults of a marching wave belong
 * to its march ({@link marchingWave}) until it is spent.
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
  // A marching wave's men answer to it alone: no tower post, raid or catapult calls them home.
  const wave = campaign ? marchingWave(world, ctx, player) : null;
  const atHome = wave === null ? army.ready : army.ready.filter((e) => !wave.men.has(e));
  const posts = towerPostOrders(world, ctx, terrain, owned, atHome);
  const free = atHome.filter((e) => !posts.claimed.has(e));
  const raiders = seatRaiders(world, ctx, terrain, player);
  const raid = raidOnTheSettlement(world, ctx, terrain, owned, raiders);
  // A raid benches the campaign: it takes the same band the muster would have gathered.
  const marchable: readonly Entity[] = raid === null ? free : [];
  const siege = campaign
    ? siegeCrewOrders(world, ctx, terrain, player, owned, marchable, wave?.catapults ?? NONE_MARCHING, raid)
    : null;
  const field = siege === null ? marchable : marchable.filter((e) => !siege.drafted.has(e));
  const offensive = campaign
    ? runOffensive(world, ctx, terrain, player, {
        army: field,
        awaitingWeapon: army.awaitingWeapon,
        wave: wave === null ? [] : army.ready.filter((e) => wave.men.has(e)),
      })
    : null;
  // Drivers of the catapults a launch took this decision are the wave's now, and a raid leaves no free man
  // to replace a driver called down.
  const launched = campaign ? marchingWave(world, ctx, player) : null;
  const parkedDrivers =
    raid !== null || siege === null
      ? []
      : siege.parkedDrivers.filter((driver) => !drivesOneOf(world, driver, launched?.catapults));
  return [
    ...enlistOrders(world, ctx, player),
    ...alarmOrders(world, ctx, terrain, owned, raiders),
    ...posts.commands,
    ...(raid === null ? [] : sortieOrders(world, terrain, free, raid)),
    ...(siege?.commands ?? []),
    ...(offensive?.commands ?? []),
    ...outfitOrders(world, ctx, terrain, player, [...(offensive?.waiting ?? []), ...parkedDrivers]),
  ];
}

const NONE_MARCHING: ReadonlySet<Entity> = new Set();

function drivesOneOf(world: World, driver: Entity, catapults: ReadonlySet<Entity> | undefined): boolean {
  if (catapults === undefined) return false;
  for (const vehicle of catapults) {
    const state = world.tryGet(vehicle, Vehicle);
    if (state !== undefined && vehicleCommander(state) === driver) return true;
  }
  return false;
}

export const militaryModule: AiPlayerModule = {
  id: 'military',
  run: (world, ctx, player) => runMilitary(world, ctx, player, true),
  whileDisabled: (world, ctx, player) => runMilitary(world, ctx, player, false),
};
