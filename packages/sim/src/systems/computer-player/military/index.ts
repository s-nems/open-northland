import { mapBriefOf } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { planSettlementDefence } from '../../ai-shared/military/settlement-defence.js';
import { ownedBuildings } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { seatBarracksOf } from '../base.js';
import type { ComputerModule } from '../index.js';
import { militaryOrdersOf } from '../strategy/military.js';
import { marchingWave } from './march/index.js';
import { runOffensive } from './offensive.js';
import { type OperationEnv, runOperations } from './operations/index.js';
import { outfitGrantOrders } from './outfit.js';
import { siegeCrewOrders } from './siege-crew.js';

export {
  type ArmyCensus,
  fighterWeaponClass,
  TOWER_POST_STRENGTH,
  takeCensus,
  type WeaponMix,
  weaponMix,
} from '../../ai-shared/military/census.js';
export {
  enemyFire,
  MAP_AI_DEFENCE_REACH_POINTS,
  MAP_AI_PEACE_ARCHERS_PER_CLASS,
  seatRaiders,
  THREAT_STAND_DOWN_MARGIN_NODES,
  TOWER_GARRISON_ARCHERS,
  threatWatchNodes,
  towerPostOrders,
} from '../../ai-shared/military/defence/index.js';
export { campaignObjective, campaignTarget } from './campaign.js';
export {
  GATHER_MARCH_TIMEOUT_TICKS,
  GATHER_QUORUM_PERCENT,
  GATHER_STANDOFF_NODES,
  GATHER_TOWER_CLEARANCE_HEX,
  GATHER_WAIT_TICKS,
  SIEGE_MARCH_MIN_CATAPULTS,
  SIEGE_TIMEOUT_TICKS,
  SIEGE_TOWER_RADIUS_NODES,
} from './march/index.js';
export {
  ASSAULT_RING_RADIUS_NODES,
  RALLY_HOLD_RADIUS_NODES,
  rallyAt,
  WAVE_MIN_SOLDIERS,
} from './muster.js';
export {
  type OperationView,
  seatOperationsOf,
} from './operations/index.js';
export { RAID_BAND_MEN, RAID_COOLDOWN_TICKS, RAID_LOOK_EVERY_DECISIONS } from './operations/raid.js';
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
} from './siege-crew.js';

/** Autonomous campaign and siege crews consume only the force left after authored assignments and
 * settlement defence. The shared defence system owns the home orders. Owner's ruling: the assistant arms
 * and dresses the army through the counters and grants the seat publishes, where the original's computer
 * player drafts and outfits its soldiers itself, matching its weapons and armour to its enemies' gear and
 * dressing armed men later. */
function runMilitary(world: World, ctx: SystemContext, player: number): readonly PlayerCommand[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // mapless sim: no ground to march over
  const owned = ownedBuildings(world, player);
  const { army, available, raid } = planSettlementDefence(world, ctx, terrain, player, true);
  const wave = marchingWave(world, ctx, player);
  const siege = siegeCrewOrders(
    world,
    ctx,
    terrain,
    player,
    owned,
    available,
    wave?.catapults ?? NONE_MARCHING,
    raid,
  );
  const free = available.filter((e) => !siege.drafted.has(e));
  const env = operationEnvOf(world, ctx, terrain, player);
  // A raid takes its band before the muster sorts the rest, so no man is the muster's and a raid's.
  const raids = env === null ? null : runOperations(env, 'beforeCampaign', free);
  const field = raids === null ? free : free.filter((e) => !raids.members.has(e));
  const campaign = runOffensive(world, ctx, terrain, player, {
    army: field,
    awaitingWeapon: army.awaitingWeapon,
    wave: wave === null ? [] : army.ready.filter((e) => wave.men.has(e)),
  });
  const assault = env === null ? null : runOperations(env, 'afterCampaign', []);
  return [
    ...siege.commands,
    ...(raids?.commands ?? []),
    ...campaign,
    ...(assault?.commands ?? []),
    ...outfitGrantOrders(world, ctx, player),
  ];
}

/** The seat's operations read its barracks door as home, else its start anchor in the map brief, so a
 *  band out when the barracks falls still comes back; none with neither. */
function operationEnvOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
): OperationEnv | null {
  const barracks = seatBarracksOf(world, ctx, seat);
  const start = mapBriefOf(world)?.seats.find((s) => s.player === seat);
  const home: NodeId | null =
    barracks !== null
      ? interactionCell(world, ctx, terrain, barracks)
      : start === undefined
        ? null
        : terrain.nodeAtClamped(start.hx, start.hy);
  if (home === null) return null;
  return { world, ctx, terrain, seat, home, orders: militaryOrdersOf(world, seat) };
}

const NONE_MARCHING: ReadonlySet<Entity> = new Set();

export const militaryModule: ComputerModule = {
  id: 'military',
  run: runMilitary,
};
