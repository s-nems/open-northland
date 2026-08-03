import { Building } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { combatTargetNode } from '../../conflict/target-node.js';
import type { SystemContext } from '../../context.js';
import { MILITARY_MODE } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { seatBarracksOf } from '../base.js';
import type { AiPlayerModule } from '../index.js';
import { campaignTarget, objectiveNode } from './campaign.js';
import { takeCensus, weaponMix } from './census.js';
import {
  gatherAt,
  marchOrders,
  meleeCoreFor,
  musterAround,
  stagingNode,
  WAVE_MIN_SOLDIERS,
  waveReady,
} from './muster.js';

export { campaignTarget, objectiveNode } from './campaign.js';
export { type ArmyCensus, takeCensus, type WeaponMix, weaponMix } from './census.js';
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

// The Military module - the seat's army: who it sends, where they gather, and what they march on. Every
// rule here comes from the user, not the data.

/**
 * One strategic decision for the seat's army: hold one {@link chargePoint}, sort the armed men around it
 * ({@link musterAround}), then roll for the charge and roll for the departure.
 *
 * Only `formed` is ever handed an attack order, and only `formed` is never recalled - a launch or a
 * skirmish drops the free count, and walking the point home for that would abandon the men in contact.
 * Both rolls span the WHOLE army rather than one group: measured over the men at home alone, a four-man
 * band and a fifth man wait on each other forever.
 */
function runMilitary(world: World, ctx: SystemContext, player: number): readonly Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // mapless sim: no ground to march over
  // The barracks is the seat's military seat: with none there is no rally point - and no army either,
  // since its drill is the seat's only route to a soldier (workforce/garrison.ts).
  const barracks = seatBarracksOf(world, ctx, player);
  if (barracks === null) return [];
  const home = interactionCell(world, ctx, terrain, barracks);
  const army = takeCensus(world, ctx, player);
  if (army.ready.length === 0 && army.awaitingWeapon.length === 0) return [];
  const target = campaignTarget(world, ctx, terrain, player, home);
  // Nothing to march on: the army regroups at the barracks, the one rally it holds in ATTACK, so it
  // meets whatever comes to the door.
  if (target === null) {
    return gatherAt(world, terrain, [...army.ready, ...army.awaitingWeapon], home, MILITARY_MODE.ATTACK);
  }

  const charge = chargePoint(world, ctx, terrain, home, target);
  const { formed, closing, waiting } = musterAround(world, terrain, army.ready, charge, home);
  const core = meleeCoreFor(weaponMix(world, ctx, army.ready));
  const charges = waveReady(ctx, weaponMix(world, ctx, formed), core);
  const musters = army.ready.length >= WAVE_MIN_SOLDIERS;
  const leaves = musters && charge !== home && waveReady(ctx, weaponMix(world, ctx, army.ready), core);
  return [
    ...(charges
      ? marchOrders(world, formed, target)
      : gatherAt(world, terrain, formed, charge, MILITARY_MODE.DEFEND)),
    ...gatherOn(world, terrain, closing, musters, charge, home),
    ...gatherOn(world, terrain, waiting, leaves, charge, home),
    ...gatherAt(world, terrain, army.awaitingWeapon, home, MILITARY_MODE.ATTACK),
  ];
}

/** Send `units` forward to the charge point (held there, so the band stays a band) or back to the
 *  barracks (where the army waits on the attack, so it meets whatever comes to the door). */
function gatherOn(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  forward: boolean,
  charge: NodeId,
  home: NodeId,
): Command[] {
  return forward
    ? gatherAt(world, terrain, units, charge, MILITARY_MODE.DEFEND)
    : gatherAt(world, terrain, units, home, MILITARY_MODE.ATTACK);
}

/** Where this decision's wave goes in from: {@link STAGING_STANDOFF_NODES} short of the WALL a standing
 *  objective would be reached at ({@link combatTargetNode} - off the door, a 26 x 20 headquarters could put
 *  the muster against its near side), the barracks when there is no room for that, and a walking
 *  objective's own node, since a standoff projected off him would move out from under the band. */
function chargePoint(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  home: NodeId,
  target: Entity,
): NodeId {
  if (!world.has(target, Building)) return objectiveNode(world, ctx, terrain, target);
  return stagingNode(terrain, home, combatTargetNode(world, ctx, terrain, home, target)) ?? home;
}

export const militaryModule: AiPlayerModule = {
  id: 'military',
  run: runMilitary,
};
