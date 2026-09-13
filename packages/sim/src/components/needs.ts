import { defineComponent, type Entity, type World } from '../ecs/world.js';

/** The four need bars a settler carries, named as the `Settler` fields they address. */
export type NeedKind = 'hunger' | 'fatigue' | 'piety' | 'enjoyment';

/**
 * A player order to answer one need now, whatever the bar reads: the drive ladder runs that need's rung as
 * if it were pressing, and the atomic that answers the need clears the order. A move, attack, or trade
 * order calls it off. Source basis: the original's own eat/sleep/talk/pray buttons set the settler's need
 * task directly (`misclogic` 4/6/8/10).
 */
export const NeedOrder = defineComponent<{ need: NeedKind }>('NeedOrder', 'settlers');

/**
 * Present while the player has prohibited this soldier's regeneration: it answers a need only from what it
 * carries and never leaves what it is doing to look for food, a bed, or a temple. A {@link NeedOrder} still
 * overrides it, and a trade change clears it. Absent means regeneration is allowed, which is the default
 * every settler is born with.
 */
export const NoRegeneration = defineComponent<{ readonly prohibited: true }>('NoRegeneration', 'settlers');

/** Drop a standing {@link NeedOrder} for `need` - the atomic that answers it has landed. */
export function clearNeedOrder(world: World, e: Entity, need: NeedKind): void {
  if (world.tryGet(e, NeedOrder)?.need === need) world.remove(e, NeedOrder);
}
