import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { entityNode } from '../../spatial/nodes.js';
import { seatBarracksOf } from '../base.js';
import { campaignTarget, objectiveNode } from './campaign.js';
import { weaponMix } from './census.js';
import { spokenFor } from './errand.js';
import { formedUpAt, gatherAt, marchOrders, meleeCoreFor, musterAround, waveWorthy } from './muster.js';
import { abandonWave, decideWave, peaceEndsAt } from './plan.js';

/** What the caller has left to spend on the campaign: the tower garrison and the band a raid takes are
 *  already out of `army`, and `awaitingWeapon` is only ever called home. */
export interface CampaignForce {
  readonly army: readonly Entity[];
  readonly awaitingWeapon: readonly Entity[];
}

/** The campaign's orders, and the men it leaves standing at the barracks door this decision. */
export interface CampaignDecision {
  readonly commands: readonly PlayerCommand[];
  readonly waiting: readonly Entity[];
}

const NO_CAMPAIGN: CampaignDecision = { commands: [], waiting: [] };

/**
 * One strategic decision for the seat's campaign: sort `army` around the barracks door
 * ({@link musterAround}), then judge the launch ({@link decideWave}). Until the peace ends ({@link peaceEndsAt}) the army
 * only gathers at the door, as it does with no target. The men at the door march when the
 * muster is the wave it was gathering; a body already nearer the objective goes in whatever the muster
 * says, having nowhere safe to wait; everybody else is called in.
 */
export function runOffensive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  { army, awaitingWeapon }: CampaignForce,
): CampaignDecision {
  if (army.length === 0 && awaitingWeapon.length === 0) return NO_CAMPAIGN;
  // No barracks, no rally point - and no army either, since its drill is the seat's only route to a
  // soldier (workforce/garrison.ts).
  const barracks = seatBarracksOf(world, ctx, player);
  if (barracks === null) return NO_CAMPAIGN;
  const home = interactionCell(world, ctx, terrain, barracks);
  // Sorted over the men this decision may actually order, so a wave is never measured at a strength the
  // march cannot fill. A man in transit sits out one decision and is read again once he arrives.
  const free = army.filter((e) => !spokenFor(world, e));
  const peaceEnd = peaceEndsAt(world, player);
  const target = ctx.tick < peaceEnd ? null : campaignTarget(world, ctx, terrain, player, home);
  if (target === null) {
    abandonWave(world, barracks);
    return {
      commands: gatherAt(world, terrain, [...army, ...awaitingWeapon], home),
      waiting: free.filter((e) => formedUpAt(world, terrain, e, home)),
    };
  }

  const objective = objectiveNode(world, ctx, terrain, target);
  const { formed, forward, homing } = musterAround(world, terrain, free, home, objective);
  // Measured over the men this decision could order, not the whole army, so a wave already marching cannot
  // bench the band still at home for the front rank it took with it.
  const core = meleeCoreFor(weaponMix(world, ctx, free));
  // The most the door can ever gather: a man across water or out on an errand never forms up.
  const doorSide = terrain.componentOf(home);
  const gatherable = free.filter(
    (e) => terrain.componentOf(entityNode(world, terrain, e)) === doorSide,
  ).length;
  const charges = decideWave(
    world,
    ctx,
    barracks,
    weaponMix(world, ctx, formed),
    army.length,
    gatherable,
    core,
    peaceEnd,
  );
  // Forward men go in with a launching wave or as a band of their own; too few for either and they come
  // home, since the size floor governs who the seat sends anywhere, not where the last fight left him.
  const pressOn = charges || waveWorthy(weaponMix(world, ctx, forward), core);

  const marching: Entity[] = [];
  const waiting: Entity[] = [];
  (charges ? marching : waiting).push(...formed);
  (pressOn ? marching : waiting).push(...forward);
  waiting.push(...homing, ...awaitingWeapon);
  return {
    commands: [
      ...marchOrders(world, terrain, marching, objective),
      ...gatherAt(world, terrain, waiting, home),
    ],
    waiting: charges ? [] : formed,
  };
}
