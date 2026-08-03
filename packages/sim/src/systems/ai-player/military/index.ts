import { Building } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { isBarracks } from '../../readviews/index.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { entityNode, manhattan } from '../../spatial/nodes.js';
import type { AiPlayerModule } from '../index.js';
import { ownedBuildings } from '../shared.js';
import { campaignTarget, objectiveNode } from './campaign.js';
import { takeCensus, weaponMix } from './census.js';
import {
  gatherAt,
  marchOrders,
  RALLY_HOLD_RADIUS_NODES,
  stagingNode,
  WAVE_MIN_SOLDIERS,
  waveReady,
} from './muster.js';

export { campaignTarget, objectiveNode } from './campaign.js';
export { type ArmyCensus, takeCensus, type WeaponMix, weaponMix } from './census.js';
export {
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
 * One strategic decision for the seat's army. The seat holds ONE charge point per decision
 * ({@link chargePoint}) and sorts its armed men around it: the band formed up on it, the men closing on
 * it, and the men still at the barracks. Only the formed-up band is ever handed an attack order, and
 * {@link waveReady} refuses a band under {@link WAVE_MIN_SOLDIERS} - so no man can be sent at the enemy
 * alone, whatever the state (user rule).
 *
 * Two rolls, both over the same band: the formed-up men charge, and the whole army sets out for the
 * charge point. Rolling the second over EVERY armed man is what lets a short band pull in the last
 * stragglers; rolling it over the men at home alone would strand a four-man band forever.
 */
function runMilitary(world: World, ctx: SystemContext, player: number): readonly Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // mapless sim: no ground to march over
  // The barracks is the seat's military seat: with none there is no rally point - and no army either,
  // since its drill is the seat's only route to a soldier (workforce/garrison.ts).
  const barracks = barracksOf(world, ctx, player);
  if (barracks === null) return [];
  const home = interactionCell(world, ctx, terrain, barracks);
  const army = takeCensus(world, ctx, player);
  if (army.ready.length === 0 && army.awaitingWeapon.length === 0) return [];
  const target = campaignTarget(world, ctx, terrain, player, home);
  // Nothing to march on, or too few men to make a wave at all: the army regroups at the barracks, which
  // is also where it defends the settlement from.
  if (target === null || army.ready.length < WAVE_MIN_SOLDIERS) {
    return gatherAt(world, terrain, [...army.ready, ...army.awaitingWeapon], home);
  }

  const charge = chargePoint(world, ctx, terrain, home, target);
  const formed: Entity[] = [];
  const closing: Entity[] = [];
  const waiting: Entity[] = [];
  for (const e of army.ready) {
    const at = entityNode(world, terrain, e);
    // A man past the halfway mark is committed forward and is never called back by a lost roll - that
    // is what keeps an arrival that landed just outside the ring from being walked home and out again.
    if (manhattan(terrain, at, charge) <= RALLY_HOLD_RADIUS_NODES) formed.push(e);
    else if (manhattan(terrain, at, charge) < manhattan(terrain, at, home)) closing.push(e);
    else waiting.push(e);
  }

  const commands: Command[] = waveReady(ctx, weaponMix(world, ctx, formed))
    ? marchOrders(world, formed, target)
    : [];
  const leaves = charge !== home && waveReady(ctx, weaponMix(world, ctx, army.ready));
  commands.push(
    ...gatherAt(world, terrain, closing, charge),
    ...gatherAt(world, terrain, waiting, leaves ? charge : home),
    ...gatherAt(world, terrain, army.awaitingWeapon, home),
  );
  return commands;
}

/** Where this decision's wave goes in from: {@link STAGING_STANDOFF_NODES} short of a STANDING objective,
 *  the barracks door when there is no room for that, and a walking objective's own node - a man is run
 *  down rather than besieged, and a standoff projected off him would move out from under the band. */
function chargePoint(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  home: NodeId,
  target: Entity,
): NodeId {
  const objective = objectiveNode(world, ctx, terrain, target);
  if (!world.has(target, Building)) return objective;
  return stagingNode(terrain, home, objective) ?? home;
}

/** The seat's canonical barracks: its lowest-id owned STANDING one, or null when it has none. A
 *  canonical pick, not the nearest, so every wave forms up at one house. */
function barracksOf(world: World, ctx: SystemContext, player: number): Entity | null {
  for (const e of ownedBuildings(world, player)) {
    if (isBarracks(world, ctx, e)) return e;
  }
  return null;
}

export const militaryModule: AiPlayerModule = {
  id: 'military',
  run: runMilitary,
};
