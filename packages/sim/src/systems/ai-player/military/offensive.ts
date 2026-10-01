import { ownerOf, WaveMarch } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { entityNode } from '../../spatial/nodes.js';
import { seatBarracksOf } from '../base.js';
import { aiProfileOf } from '../difficulty.js';
import { campaignTarget, objectiveNode } from './campaign.js';
import { defendingStrength, fighterStrength, weaponMix } from './census.js';
import { spokenFor } from './errand.js';
import { advanceWave, endMarch, launchWave } from './march/index.js';
import {
  formedUpAt,
  gatherAt,
  marchOrders,
  meleeCoreFor,
  musterAround,
  rallyAt,
  waveWorthy,
} from './muster.js';
import { abandonWave, decideWave, peaceEndsAt } from './plan.js';

/** What the caller has left to spend on the campaign: the tower garrison and the band a raid takes are
 *  already out of `army`, `awaitingWeapon` is only ever called home, and `wave` holds the free men of the
 *  wave already marching. */
export interface CampaignForce {
  readonly army: readonly Entity[];
  readonly awaitingWeapon: readonly Entity[];
  readonly wave: readonly Entity[];
}

/** The campaign's orders, and the men it leaves standing at the barracks door this decision. */
export interface CampaignDecision {
  readonly commands: readonly PlayerCommand[];
  readonly waiting: readonly Entity[];
}

const NO_CAMPAIGN: CampaignDecision = { commands: [], waiting: [] };

/**
 * One strategic decision for the seat's campaign: the marching wave takes its next step
 * ({@link advanceWave}), then the rest of `army` is sorted around the barracks door ({@link musterAround})
 * and, with no wave out, the launch is judged ({@link decideWave}). Until the peace ends
 * ({@link peaceEndsAt}) and the difficulty's first wave may march, the army only gathers at the door, as
 * it does with no target. The men at the door set out as a wave when the muster is the one it was
 * gathering and the target's owner does not outnumber the seat; a body already nearer the objective goes
 * in whatever the muster says, having nowhere safe to wait; everybody else is called in.
 */
export function runOffensive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  { army, awaitingWeapon, wave }: CampaignForce,
): CampaignDecision {
  // No barracks, no rally point - and no army either, since its drill is the seat's only route to a
  // soldier (workforce/garrison.ts).
  const barracks = seatBarracksOf(world, ctx, player);
  if (barracks === null) return NO_CAMPAIGN;
  const atHome = army.length > 0 || awaitingWeapon.length > 0;
  if (!atHome && !world.has(barracks, WaveMarch)) return NO_CAMPAIGN;
  const home = interactionCell(world, ctx, terrain, barracks);
  const { army: armyProfile } = aiProfileOf(world, player);
  const peaceEnd = Math.max(peaceEndsAt(world, player), armyProfile.firstWaveFromTick);
  const target = ctx.tick < peaceEnd ? null : campaignTarget(world, ctx, terrain, player, home);
  if (target === null) {
    abandonWave(world, barracks);
    endMarch(world, barracks);
    const everyone = [...army, ...wave, ...awaitingWeapon];
    const rally = rallyAt(world, ctx, terrain, home, everyone);
    return {
      commands: gatherAt(world, terrain, everyone, rally),
      waiting: army.filter((e) => !spokenFor(world, e) && formedUpAt(world, terrain, e, rally)),
    };
  }

  const objective = objectiveNode(world, ctx, terrain, target);
  const marchOn = advanceWave(world, ctx, terrain, barracks, player, target, objective, wave);
  if (!atHome && (marchOn.active || wave.length === 0)) return { commands: marchOn.commands, waiting: [] };
  // A wave spent this decision hands its men back to the muster.
  const muster = marchOn.active ? army : [...army, ...wave].sort((a, b) => a - b);
  const rally = rallyAt(world, ctx, terrain, home, [...muster, ...awaitingWeapon]);
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
  // of its men is not benched by its own defence; the target's posted men weigh what they kill.
  const targetOwner = ownerOf(world, target);
  const strength = {
    own: fighterStrength(world, ctx, player),
    opposing: targetOwner === undefined ? 0 : defendingStrength(world, ctx, targetOwner),
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
    );
  const launch = charges
    ? launchedWaveOrders(world, ctx, terrain, { barracks, player, home, target, objective }, formed)
    : [];
  // Forward men go in with a launching wave or as a band of their own; too few for either and they come
  // home, since the size floor governs who the seat sends anywhere, not where the last fight left him.
  const pressOn = charges || waveWorthy(weaponMix(world, ctx, forward), core);

  const waiting: Entity[] = charges ? [] : [...formed];
  if (!pressOn) waiting.push(...forward);
  waiting.push(...homing, ...awaitingWeapon);
  return {
    commands: [
      ...marchOn.commands,
      ...launch,
      ...marchOrders(world, terrain, pressOn ? forward : [], objective),
      ...gatherAt(world, terrain, waiting, rally),
    ],
    waiting: charges ? [] : formed,
  };
}

interface Launch {
  readonly barracks: Entity;
  readonly player: number;
  readonly home: NodeId;
  readonly target: Entity;
  readonly objective: NodeId;
}

/** Send `formed` out as the seat's wave, with the catapults parked at home, and give its first leg. */
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
