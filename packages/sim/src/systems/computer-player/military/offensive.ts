import { seatPeaceEndTick, WaveMarch } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { weaponMix } from '../../ai-shared/military/census.js';
import { spokenFor } from '../../ai-shared/military/errand.js';
import { seatOutmatched } from '../../ai-shared/military/settlement-defence.js';
import type { SystemContext } from '../../context.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { entityNode } from '../../spatial/nodes.js';
import { seatBarracksOf, seatBaseOf } from '../base.js';
import { computerProfileOf } from '../difficulty.js';
import { militaryOrdersOf } from '../strategy/military.js';
import { campaignObjective } from './campaign.js';
import { believedDefendingPoints, COUNTED_ONCE, ownArmyPoints } from './enemy-strength.js';
import { advanceWave, endMarch, launchWave, SIEGE_MARCH_MIN_CATAPULTS } from './march/index.js';
import { gatherAt, marchOrders, meleeCoreFor, musterAround, rallyAt, waveWorthy } from './muster.js';
import { abandonWave, decideWave } from './plan.js';
import { crewedCatapults } from './siege-crew.js';
import { templeStationOf } from './temple-station.js';
import { towerStandOf } from './tower-stand.js';

/** What the caller has left to spend on the campaign: the tower garrison and the band a raid takes are
 *  already out of `army`, `awaitingWeapon` (the men still to be armed or dressed) is only ever called
 *  home, and `wave` holds the free men of the wave already marching. */
export interface CampaignForce {
  readonly army: readonly Entity[];
  readonly awaitingWeapon: readonly Entity[];
  readonly wave: readonly Entity[];
}

const NO_CAMPAIGN: readonly PlayerCommand[] = [];

/**
 * One strategic decision for the seat's campaign: the marching wave takes its next step
 * ({@link advanceWave}), then the rest of `army` is sorted around the barracks door ({@link musterAround})
 * and, with no wave out, the launch is judged ({@link decideWave}). Until the peace ends
 * ({@link seatPeaceEndTick}) and the difficulty's first wave may march, and while the seat's posture holds the
 * army home (`strategy/military.ts`), the army only gathers at home ({@link armedStandOf}),
 * as it does with no target, a marching wave called back. The men at the door set out as a wave when the
 * muster is the one it was gathering and the seat's points reach its plan's edge over the target owner's; a
 * body already nearer the objective goes in whatever the muster says, having nowhere safe to wait;
 * everybody else is called in.
 */
export function runOffensive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  { army, awaitingWeapon, wave }: CampaignForce,
): readonly PlayerCommand[] {
  // No barracks, no rally point - and no army either, since its drill is the seat's only route to a
  // soldier (workforce/garrison.ts).
  const barracks = seatBarracksOf(world, ctx, player);
  if (barracks === null) return NO_CAMPAIGN;
  const atHome = army.length > 0 || awaitingWeapon.length > 0;
  if (!atHome && !world.has(barracks, WaveMarch)) return NO_CAMPAIGN;
  const home = interactionCell(world, ctx, terrain, barracks);
  const { army: armyProfile } = computerProfileOf(world, player);
  const peaceEnd = Math.max(seatPeaceEndTick(world, player), armyProfile.firstWaveFromTick);
  const orders = militaryOrdersOf(world, player);
  const launchRatio = orders.launchRatio;
  const goal =
    ctx.tick < peaceEnd || launchRatio === null ? null : campaignObjective(world, ctx, terrain, player, home);
  if (goal === null || launchRatio === null) {
    abandonWave(world, barracks);
    endMarch(world, barracks);
    // The men awaiting a weapon stay by the barracks that arms them.
    const stand = armedStandOf(world, ctx, terrain, player, home);
    if (stand !== null) {
      const armed = [...army, ...wave];
      const atStand = rallyAt(world, ctx, terrain, stand, armed);
      const atDoor = rallyAt(world, ctx, terrain, home, awaitingWeapon);
      return [
        ...gatherAt(world, terrain, armed, atStand),
        ...gatherAt(world, terrain, awaitingWeapon, atDoor),
      ];
    }
    const everyone = [...army, ...wave, ...awaitingWeapon];
    const rally = rallyAt(world, ctx, terrain, home, everyone);
    return gatherAt(world, terrain, everyone, rally);
  }

  const { entity: target, owner: targetOwner, node: objective } = goal;
  const marchOn = advanceWave(world, ctx, terrain, barracks, player, target, objective, wave);
  if (!atHome && (marchOn.active || wave.length === 0)) return marchOn.commands;
  // A wave spent this decision hands its men back to the muster.
  const muster = marchOn.active ? army : [...army, ...wave].sort((a, b) => a - b);
  // The armed men wait, and a wave forms, inside a temple's aura; the men awaiting a weapon stay by the
  // barracks that arms them.
  const blessed = templeStationOf(world, ctx, terrain, player, home);
  const station = blessed === home ? null : blessed;
  const rally = rallyAt(
    world,
    ctx,
    terrain,
    station ?? home,
    station === null ? [...muster, ...awaitingWeapon] : muster,
  );
  const doorRally = station === null ? rally : rallyAt(world, ctx, terrain, home, awaitingWeapon);
  // Sorted over the men this decision may actually order, so a wave is never measured at a strength the
  // march cannot fill. A man in transit sits out one decision and is read again once he arrives.
  const free = muster.filter((e) => !spokenFor(world, e));
  const { formed, forward, homing } = musterAround(world, terrain, free, rally, objective);
  // Measured over the men this decision could order, not the whole army, so a wave already marching cannot
  // bench the band still at home for the front rank it took with it.
  const core = meleeCoreFor(weaponMix(world, ctx, free));
  const doorSide = terrain.componentOf(home);
  const onDoorSide = (e: Entity): boolean => terrain.componentOf(entityNode(world, terrain, e)) === doorSide;
  const door = {
    mustered: muster.length,
    gatherable: free.filter(onDoorSide).length,
    walkingIn: homing.filter(onDoorSide).length,
  };
  // Both sides weighed whole, garrisons and men in a fight included, so a seat whose towers hold a third
  // of its men is not benched by its own defence; the target's posted men weigh what they kill. The
  // target's side is what the seat has seen of it. A siege train at home outranges the towers, so their
  // posted men then weigh what any man does.
  const own = ownArmyPoints(world, ctx, player);
  const postedWeight =
    crewedCatapults(world, ctx, player).length >= SIEGE_MARCH_MIN_CATAPULTS ? COUNTED_ONCE : undefined;
  const strength = {
    own: own.points,
    ownMen: own.men,
    opposing: believedDefendingPoints(world, ctx, player, targetOwner, own.points, postedWeight),
  };
  // One wave at a time: the next gathers at the door while the last one marches.
  const charges =
    !marchOn.active &&
    decideWave(
      world,
      ctx,
      barracks,
      weaponMix(world, ctx, formed),
      door,
      core,
      peaceEnd,
      strength,
      armyProfile.cap,
      launchRatio,
    );
  const launch = charges
    ? launchedWaveOrders(world, ctx, terrain, { barracks, player, home, target, objective }, formed)
    : [];
  // Forward men go in with a launching wave or as a band of their own; too few for either and they come
  // home, since the size floor governs who the seat sends anywhere, not where the last fight left him.
  const pressOn = charges || waveWorthy(weaponMix(world, ctx, forward), core);

  const waiting: Entity[] = charges ? [] : [...formed];
  if (!pressOn) waiting.push(...forward);
  waiting.push(...homing);
  if (station === null) waiting.push(...awaitingWeapon);
  return [
    ...marchOn.commands,
    ...launch,
    ...marchOrders(world, terrain, pressOn ? forward : [], objective),
    ...gatherAt(world, terrain, waiting, rally),
    ...(station === null ? [] : gatherAt(world, terrain, awaitingWeapon, doorRally)),
  ];
}

/**
 * Where the armed men at home gather apart from the barracks door `home`, or null for the door: a seat
 * awaiting a scripted attack under its tower line ({@link towerStandOf}, which moves into a temple's aura
 * the towers still reach); else an outmatched seat at its base, under its towers, rather than at a
 * barracks out on the front, where they would meet a wave before the towers could shoot it (owner ruling:
 * survive at any cost); else inside a temple's aura ({@link templeStationOf}), the base's or the door's
 * nearest spot of it.
 */
function armedStandOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  home: NodeId,
): NodeId | null {
  const stand = towerStandOf(world, ctx, terrain, player, home);
  if (stand !== null) return stand;
  const base = seatOutmatched(world, player) ? seatBaseOf(world, ctx, player) : null;
  const at = base === null ? home : interactionCell(world, ctx, terrain, base);
  const blessed = templeStationOf(world, ctx, terrain, player, at) ?? at;
  return blessed === home ? null : blessed;
}

interface Launch {
  readonly barracks: Entity;
  readonly player: number;
  readonly home: NodeId;
  readonly target: Entity;
  readonly objective: NodeId;
}

/** Send `formed` out as the seat's wave, with the catapults parked at home, toward its gathering point. */
function launchedWaveOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  { barracks, player, home, target, objective }: Launch,
  formed: readonly Entity[],
): readonly PlayerCommand[] {
  launchWave(world, ctx, terrain, barracks, player, home, target, objective, formed);
  return advanceWave(world, ctx, terrain, barracks, player, target, objective, formed).commands;
}
