import { Building, Stance } from '../../../components/index.js';
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
import { type ArmyCensus, takeCensus, weaponMix } from './census.js';
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
 * Only `formed` is handed an attack order, and only `formed` is never recalled - a launch or a skirmish
 * drops the free count, and walking the point home for that would abandon the men in contact. The
 * departure roll spans the WHOLE army rather than the men at home, or a four-man band and a fifth man
 * would wait on each other forever.
 */
function runMilitary(world: World, ctx: SystemContext, player: number): readonly Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // mapless sim: no ground to march over
  // The barracks is the seat's military seat: with none there is no rally point - and no army either,
  // since its drill is the seat's only route to a soldier (workforce/garrison.ts).
  const barracks = seatBarracksOf(world, ctx, player);
  const army = takeCensus(world, ctx, player);
  if (army.ready.length === 0 && army.awaitingWeapon.length === 0) return [];
  // The barracks is the seat's rally, so losing it leaves the army nowhere to form up. Its men are put
  // back on the attack rather than left holding a field post they would never be released from.
  if (barracks === null) return standDown(world, army);
  const home = interactionCell(world, ctx, terrain, barracks);
  const target = campaignTarget(world, ctx, terrain, player, home);
  if (target === null) {
    return gatherAt(world, terrain, [...army.ready, ...army.awaitingWeapon], home, MILITARY_MODE.ATTACK);
  }

  const charge = chargePoint(world, ctx, terrain, home, target);
  const { formed, closing, waiting } = musterAround(world, terrain, army.ready, charge, home);
  const core = meleeCoreFor(weaponMix(world, ctx, army.ready));
  const charges = waveReady(ctx, weaponMix(world, ctx, formed), core);
  // Sized over the WHOLE armed force, the men in the fight included: measured over the free ones, every
  // launch would read as a collapse and turn the rank behind it around 40 nodes out.
  const musters = army.ready.length + army.committed >= WAVE_MIN_SOLDIERS;
  const leaves = musters && charge !== home && waveReady(ctx, weaponMix(world, ctx, army.ready), core);
  // A charge point at the barracks is the barracks: the fight is already at the door, and the garrison
  // holds it on the attack rather than blinkering itself down to a defend radius.
  const forward = charge === home ? MILITARY_MODE.ATTACK : MILITARY_MODE.DEFEND;
  const gather = (units: readonly Entity[], out: boolean): Command[] =>
    out
      ? gatherAt(world, terrain, units, charge, forward)
      : gatherAt(world, terrain, units, home, MILITARY_MODE.ATTACK);
  return [
    ...(charges ? marchOrders(world, formed, target) : gather(formed, true)),
    ...gather(closing, musters),
    ...gather(waiting, leaves),
    ...gatherAt(world, terrain, army.awaitingWeapon, home, MILITARY_MODE.ATTACK),
  ];
}

/** Put every fighter back on the fighter default. The gathering hold is only ever released here, so a
 *  seat that loses its barracks mid-campaign does not strand its band on a post in an empty field. */
function standDown(world: World, army: ArmyCensus): Command[] {
  return [...army.ready, ...army.awaitingWeapon].flatMap((e) =>
    world.tryGet(e, Stance)?.mode === MILITARY_MODE.DEFEND
      ? [{ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK } as const]
      : [],
  );
}

/** Where this decision's wave goes in from: {@link STAGING_STANDOFF_NODES} short of the WALL a standing
 *  objective would be reached at ({@link combatTargetNode}), the barracks when there is no room for that,
 *  and a walking objective's own node, since a standoff projected off him would move out from under the
 *  band. Off the DOOR instead, a body wider than the standoff would put the muster against its near wall -
 *  eight nodes into it for the base headquarters, thirty for the largest authored wonder. */
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
