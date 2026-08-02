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
// Deliberately the leaves, not the goods barrel: that barrel re-exports the equip effect, which now
// applies the good→class transform through this module, so routing these through it would close an
// import cycle.
import { addCarry } from '../../settlers/atomics/effects/goods/carry.js';
import { placeUnitOnTile } from '../../settlers/atomics/effects/goods/piles.js';
import { isUsed } from '../../settlers/atomics/effects/goods/wear.js';
import { syncWorkFlagToJob } from '../work-flag.js';

/**
 * Take up `jobType`: retire what the OLD trade owned (its errands, its auto-combat state, the gear the new
 * trade may not wear) and stamp the new trade's defaults. The single home of "this settler's trade
 * changed", so the employment orders (`orders/work/employment.ts`), the barracks drill
 * (`settlers/drives/training.ts`) and the armed-class flip cannot apply half of it each.
 *
 * It re-tasks nothing: cancelling the settler's action, route and player order is the ordered paths' own
 * step ({@link import('../../orders/work/employment.js').reidleAsJob}). The binding is likewise the
 * caller's: `setJob` drops it, `assignWorker` sets one ({@link import('./binding.js').bindEmployment}).
 */
export function applyTradeChange(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  setSettlerJob(world, e, jobType);
  world.remove(e, TrainingOrder); // a trade change calls off a drill errand: the settler was re-tasked
  if (isFighterJob(ctx.content, jobType)) shedToolOnEnlist(world, e);
  world.remove(e, SiteAssignment); // the old trade's construction-crew membership goes
  // And its supply errand: the site must stop counting the abandoned fetch as inbound (the planner's
  // tally re-seeds from live components each tick).
  world.remove(e, SupplyRun);
  world.remove(e, Engagement); // drop any auto-combat state; the new trade re-decides its stance
  world.remove(e, AttackOrder);
  world.remove(e, Fleeing);
  world.remove(e, HuntRest); // an ex-hunter's acquisition breather has nothing left to throttle
  // Owned-only, like the spawn stamp: an unowned settler keeps its content-relation combat behavior and
  // carries no Stance at all (the component's contract), so a neutral auto-hire must not gain one.
  if (world.has(e, Owner)) stampDefaultStance(world, ctx.content, e, jobType);
  // Leaving the fighter trades disarms the settler on both axes, the Equipment display slots and the
  // combat Weapon/Armor, because the render draws the armed look from the equipped weapon good over the
  // job, so a kept weapon would freeze an ex-soldier in the warrior skin.
  if (!isFighterJob(ctx.content, jobType)) {
    world.remove(e, Weapon);
    world.remove(e, Armor);
    shedSlotGood(world, e, 'weapon', 'hands');
    shedSlotGood(world, e, 'armor', 'hands');
    world.remove(e, AssistantRecruit); // leaving the fighter band cancels the assistant's booking
  }
  syncWorkFlagToJob(world, ctx, e, jobType); // a gatherer trade carries a work flag; other trades don't
  world.remove(e, GatherSelection); // the picks die with the employment they were made under
  world.remove(e, CraftSelection);
}

/**
 * A fighter keeps no tool - it aids only production work (user rule 2026-07-25) - so entering a
 * soldier/hero trade empties the slot and calls off a tool-slot equip errand in flight (an errand for
 * another slot survives, as on any job change). The freed unit goes straight to the ground: a recruit
 * marches off, it does not run the tool to a store first.
 */
function shedToolOnEnlist(world: World, e: Entity): void {
  const order = world.tryGet(e, EquipOrder);
  if (order !== undefined && order.group === 'tool') world.remove(e, EquipOrder);
  shedSlotGood(world, e, 'tool', 'ground');
}

/**
 * Empty one equipment slot the settler's NEW trade may not use, without swallowing the good. A part-used
 * unit is destroyed, as is one on a positionless settler (the take-off rule,
 * settlers/atomics/effects/goods/equip.ts). A fresh one lands per `into`, the two halves of the user's
 * 2026-07-26 rule "a store if the economy can manage it, the ground otherwise":
 *
 *  - `hands`: free or same-good hands take it and the delivery drive banks it; anything the hands cannot
 *    take (the second unit, or either one on a loaded settler) falls to the tile for a porter;
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
  world.write(e, Equipment, (eq) => {
    eq[group] = null;
  });
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
