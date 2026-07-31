import { type CurrentAtomic, ownerOf, Settler } from '../../../../components/index.js';
import { assertNever } from '../../../../core/brand.js';
import { fx } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { advanceConstructionLabor } from '../../../economy/construction.js';
import { applySow, applyWater } from '../../../economy/fields.js';
import { EAT_HUNGER_RESTORE, relieveNeed, SLEEP_FATIGUE_RESTORE } from '../../../lifecycle/needs.js';
import {
  grantCarryExperience,
  grantScoutExperience,
  grantWorkExperience,
} from '../../../progression/index.js';
import { erectSignpost } from '../../../signposts/index.js';
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

/** The live {@link CurrentAtomic} fields a completed effect reads, plus the `workCredit` a harvest swing
 *  banks back onto the running component. */
type CompletedAtomic = Pick<
  NonNullable<(typeof CurrentAtomic)['__value']>,
  'atomicId' | 'duration' | 'effect' | 'workCredit'
>;

/**
 * Apply a completed atomic's effect. Exhaustive over the `AtomicEffect` union (`assertNever` makes a new
 * variant a compile error here), so behavior is the typed effect, never an opaque atomicId. Returns the
 * units a `harvest` swing extracted - the executor's release signal - and undefined otherwise.
 */
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
    case 'pickup':
      pickupFromStore(world, ctx, settler, effect.from, effect.goodType, effect.amount);
      return;
    case 'draw':
      drawUtilityGood(world, settler, effect.goodType);
      return;
    case 'pileup':
      if (pileupIntoStore(world, ctx, settler, effect.store) > 0) grantCarryExperience(world, ctx, settler);
      return;
    case 'eat':
      consumeFood(world, settler, effect.from, effect.goodType);
      relieveHunger(world, settler);
      return;
    case 'forage':
      forageBerry(world, ctx, effect.bush);
      relieveHunger(world, settler);
      return;
    case 'drink':
      drinkDraught(world, ctx, settler, effect.slot);
      return;
    case 'sleep': {
      const s = world.tryGet(settler, Settler);
      if (s !== undefined) s.fatigue = relieveNeed(s.fatigue, SLEEP_FATIGUE_RESTORE);
      return;
    }
    case 'pray':
      clearNeed(world, settler, 'piety');
      return;
    case 'enjoy':
    case 'make_love':
      clearNeed(world, settler, 'enjoyment');
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
    case 'construct':
      advanceConstructionLabor(world, ctx, effect.site);
      return;
    case 'sow':
      applySow(world, ctx, effect);
      return;
    case 'water':
      applyWater(world, effect.crop);
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
    // Nothing lands on completion: walking is the navigation layer's (`move`/`idle`), an `attack`'s blow
    // already landed mid-animation at its hit frame, and no planner emits `produce` - the ProductionSystem
    // advances crafting cycles from the workplace itself, never from a worker's atomic.
    case 'move':
    case 'idle':
    case 'attack':
    case 'produce':
      return;
    default:
      assertNever(effect);
  }
}

/** Credit one meal to the eater's hunger bar - `eat` and `forage` feed identically in the original.
 *  No-op on an entity that is no longer a {@link Settler}. */
function relieveHunger(world: World, settler: Entity): void {
  const s = world.tryGet(settler, Settler);
  if (s !== undefined) s.hunger = relieveNeed(s.hunger, EAT_HUNGER_RESTORE);
}

/** Zero a need the satisfying act clears outright (rather than the partial refill `eat`/`sleep` give),
 *  closing the NeedsSystem's rise→satisfy→reset loop. No-op on a non-{@link Settler}. */
function clearNeed(world: World, settler: Entity, need: 'piety' | 'enjoyment'): void {
  const s = world.tryGet(settler, Settler);
  if (s !== undefined) s[need] = fx.fromInt(0);
}
