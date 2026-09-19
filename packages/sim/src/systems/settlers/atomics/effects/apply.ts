import { type CurrentAtomic, clearNeedOrder, ownerOf } from '../../../../components/index.js';
import { assertNever } from '../../../../core/brand.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { openChest } from '../../../chests/index.js';
import type { SystemContext } from '../../../context.js';
import { advanceConstructionLabor } from '../../../economy/construction.js';
import { applySow, applyWater } from '../../../economy/fields.js';
import {
  grantCarryExperience,
  grantProfessionExperience,
  grantScoutExperience,
  grantWorkExperience,
} from '../../../progression/index.js';
import { erectSignpost } from '../../../signposts/index.js';
import { loadCart, unloadCart } from '../../../trade/index.js';
import { serveDrillRepetition } from '../../drives/training.js';
import {
  consumeFood,
  drawUtilityGood,
  drinkDraught,
  dropCarriedLoad,
  equipFromStore,
  forageBerry,
  harvestFromNode,
  pickupFromStore,
  pileupIntoStore,
  swingWorkUnits,
  unequipWornGood,
} from './goods/index.js';

/** A live view onto the running {@link CurrentAtomic}: a harvest swing banks `workCredit` back through it. */
type CompletedAtomic = Pick<
  NonNullable<(typeof CurrentAtomic)['__value']>,
  'atomicId' | 'duration' | 'effect' | 'workCredit'
>;

/** Apply a completed atomic's effect. Returns the units a `harvest` swing extracted, undefined otherwise. */
export function applyEffect(
  world: World,
  ctx: SystemContext,
  settler: Entity,
  atomic: CompletedAtomic,
): number | undefined {
  const effect = atomic.effect;
  switch (effect.kind) {
    case 'harvest': {
      const units = harvestFromNode(
        world,
        ctx,
        settler,
        effect.resource,
        effect.goodType,
        swingWorkUnits(world, ctx, settler, atomic, effect.goodType),
      );
      grantWorkExperience(world, ctx, settler, effect.goodType, units);
      return units;
    }
    // Fishing owns its multi-clip state machine in the executor; it never reaches the generic applier.
    case 'fish':
      return;
    case 'pickup':
      pickupFromStore(world, ctx, settler, effect.from, effect.goodType, effect.amount);
      return;
    case 'draw':
      drawUtilityGood(world, settler, effect.goodType);
      return;
    case 'pileup':
      if (pileupIntoStore(world, ctx, settler, effect.store) > 0) grantCarryExperience(world, ctx, settler);
      return;
    case 'cartLoad':
      loadCart(world, ctx, settler, effect.from, effect.goodType);
      return;
    case 'cartUnload':
      unloadCart(world, ctx, settler, effect.store, effect.goodType);
      return;
    // The meal itself was paid out at the clip's own event frame; the unit leaves the shelf here. The eat
    // clips carry no `interruptable`, so an order parks behind one rather than splitting the two halves.
    case 'eat':
      consumeFood(world, settler, effect.from, effect.goodType);
      clearNeedOrder(world, settler, 'hunger');
      return;
    case 'forage':
      forageBerry(world, ctx, effect.bush);
      clearNeedOrder(world, settler, 'hunger');
      return;
    case 'drink':
      drinkDraught(world, ctx, settler, effect.slot);
      return;
    case 'exercise':
      serveDrillRepetition(world, settler, atomic.duration);
      return;
    case 'erectSignpost': {
      const terrain = ctx.terrain;
      const player = ownerOf(world, settler);
      if (terrain === undefined || player === undefined) return;
      const post = erectSignpost(world, ctx, terrain, terrain.nodeAt(effect.x, effect.y), player);
      if (post !== null) grantScoutExperience(world, ctx.content, settler);
      return;
    }
    case 'openChest':
      openChest(world, ctx, settler, effect.chest);
      return;
    case 'construct':
      if (advanceConstructionLabor(world, ctx, effect.site)) grantProfessionExperience(world, ctx, settler);
      return;
    case 'sow':
      applySow(world, ctx, effect);
      return;
    case 'water':
      applyWater(world, effect.crop);
      return;
    // The wares were already banked at the clip's own frames; what lands here is the breeder's
    // experience, the clip's `GET_EXPERIENCE` frame.
    case 'slay':
      grantWorkExperience(world, ctx, settler, effect.species, 1);
      return;
    case 'drop':
      dropCarriedLoad(world, ctx.terrain, settler);
      return;
    case 'equip':
      equipFromStore(world, ctx, settler, effect.from, effect.goodType, effect.group, effect.slot);
      return;
    case 'unequip':
      unequipWornGood(world, ctx, settler, effect.group, effect.slot, effect.sink);
      return;
    // The bars these serve were paid out frame by frame from the clip's own events; finishing the clip is
    // what answers a player's need order.
    case 'sleep':
      clearNeedOrder(world, settler, 'fatigue');
      return;
    case 'pray':
      clearNeedOrder(world, settler, 'piety');
      return;
    // Nothing lands on completion: movement belongs to the navigation layer, an `attack` already landed at
    // its hit frame, and crafting cycles advance from the workplace, never from a worker's atomic.
    case 'move':
    case 'idle':
    case 'attack':
    case 'produce':
      return;
    default:
      assertNever(effect);
  }
}
