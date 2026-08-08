import {
  Armor,
  AssistantRecruit,
  AttackOrder,
  Carrying,
  CraftSelection,
  Engagement,
  Equipment,
  EquipOrder,
  Fleeing,
  GatherSelection,
  HuntFocus,
  HuntRest,
  Owner,
  Position,
  SiteAssignment,
  SupplyRun,
  setSettlerJob,
  TrainingOrder,
  Weapon,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
// Deliberately the module, not `orders/index.js`: that barrel re-exports `orders/work/employment.js`,
// which imports this package's barrel, so routing the stance stamp through it would close an import cycle.
import { stampDefaultStance } from '../../orders/combat.js';
import { isFighterJob } from '../../readviews/index.js';
// Deliberately the leaves, not the goods barrel: that barrel re-exports the equip effect, which applies
// the good-to-class transform through this module, so a barrel import would close a cycle.
import { addCarry } from '../../settlers/atomics/effects/goods/carry.js';
import { placeUnitOnTile } from '../../settlers/atomics/effects/goods/piles.js';
import { isUsed } from '../../settlers/atomics/effects/goods/wear.js';
import { syncWorkFlagToJob } from '../work-flag.js';

/**
 * Take up `jobType`: retire what the old trade owned - its errands, its auto-combat state, and the gear the
 * new trade may not wear - and stamp the new trade's defaults. The single home of "this settler's trade
 * changed", so no caller can apply half of it. It re-tasks nothing and touches no workplace binding:
 * cancelling the settler's action, route and player order, and setting or dropping the binding, are the
 * calling path's own steps.
 */
export function applyTradeChange(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  setSettlerJob(world, e, jobType);
  world.remove(e, TrainingOrder); // a trade change calls off a drill errand
  if (isFighterJob(ctx.content, jobType)) shedToolOnEnlist(world, e);
  world.remove(e, SiteAssignment);
  // The site must stop counting the abandoned fetch as inbound; the planner's tally re-seeds from live
  // components each tick.
  world.remove(e, SupplyRun);
  world.remove(e, Engagement); // drop any auto-combat state; the new trade re-decides its stance
  world.remove(e, AttackOrder);
  world.remove(e, Fleeing);
  world.remove(e, HuntRest);
  world.remove(e, HuntFocus);
  // Owned-only, like the spawn stamp: an unowned settler keeps its content-relation combat behavior and
  // carries no Stance at all, so a neutral settler must not gain one here.
  if (world.has(e, Owner)) stampDefaultStance(world, ctx.content, e, jobType);
  // Leaving the fighter trades disarms both the Equipment display slots and the combat Weapon/Armor,
  // because the render draws the armed look from the equipped weapon good over the job.
  if (!isFighterJob(ctx.content, jobType)) {
    world.remove(e, Weapon);
    world.remove(e, Armor);
    shedSlotGood(world, e, 'weapon', 'hands');
    shedSlotGood(world, e, 'armor', 'hands');
    world.remove(e, AssistantRecruit); // leaving the fighter band cancels the assistant's booking
  }
  syncWorkFlagToJob(world, ctx, e, jobType);
  world.remove(e, GatherSelection); // the picks die with the employment they were made under
  world.remove(e, CraftSelection);
}

/**
 * Authored: a fighter keeps no tool, since a tool aids only production work. Entering a soldier or hero
 * trade empties the slot and calls off a tool-slot equip errand in flight. The freed unit goes straight to
 * the ground - a recruit marches off rather than running the tool to a store first.
 */
function shedToolOnEnlist(world: World, e: Entity): void {
  const order = world.tryGet(e, EquipOrder);
  if (order !== undefined && order.group === 'tool') world.remove(e, EquipOrder);
  shedSlotGood(world, e, 'tool', 'ground');
}

/**
 * Empty one equipment slot the settler's new trade may not use, without swallowing the good. A part-used
 * unit is destroyed, as is one on a positionless settler. A fresh one lands per `into`, the two halves of
 * the authored rule "a store if the economy can manage it, the ground otherwise":
 *
 *  - `hands`: free or same-good hands take it and the delivery drive banks it; anything the hands cannot
 *    take falls to the tile for a porter;
 *  - `ground`: straight to the tile, whatever the hands hold.
 */
function shedSlotGood(
  world: World,
  e: Entity,
  group: 'tool' | 'weapon' | 'armor',
  into: 'hands' | 'ground',
): void {
  const equipment = world.tryGet(e, Equipment);
  const worn = equipment?.[group];
  if (equipment === undefined || worn == null) return;
  const eq = world.mut(e, Equipment);
  eq[group] = null;
  if (isUsed(worn)) return;
  const held = world.tryGet(e, Carrying);
  if (into === 'hands' && (held === undefined || held.goodType === worn.goodType)) {
    addCarry(world, e, worn.goodType, 1);
    return;
  }
  const pos = world.tryGet(e, Position);
  if (pos === undefined) return;
  const node = nodeOfPosition(pos.x, pos.y);
  const at = positionOfNode(node.hx, node.hy); // the node's canonical lattice tile, so drops stack
  placeUnitOnTile(world, at.x, at.y, worn.goodType);
}
