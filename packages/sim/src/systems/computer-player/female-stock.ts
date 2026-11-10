import { AssistantChildOrder, ChildOrder, Female, ownerOf, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { homeSettlers } from '../ai-shared/home-roster.js';
import type { SystemContext } from '../context.js';
import { isOnMission } from '../family/eligibility.js';

/** The women, girls and baby girls among `settlers` who will fill family slots, and the daughters a
 *  family ordered itself. Female mission units do not count: their job permanently excludes them from
 *  family life, just as it excludes them from marrying. */
export function femaleStockOf(world: World, ctx: SystemContext, settlers: readonly Entity[]): number {
  let stock = 0;
  for (const e of settlers) {
    if (world.has(e, Female) && !isOnMission(ctx.content, world.get(e, Settler).jobType)) stock++;
    if (world.tryGet(e, ChildOrder)?.child === 'female' && !world.has(e, AssistantChildOrder)) stock++;
  }
  return stock;
}

/** Every family slot the seat's women and daughters will want: its {@link femaleStockOf} and the daughters
 *  the assistant booked. The housing lane (`build-order/steps/housing.ts`) keeps the homes ahead of it. */
export function femaleDemand(world: World, ctx: SystemContext, player: number): number {
  let bySeat = demands.get(world);
  if (bySeat === undefined) {
    bySeat = new Map();
    demands.set(world, bySeat);
  }
  const held = bySeat.get(player);
  if (held !== undefined && held.version === world.mutationVersion && held.content === ctx.content)
    return held.demand;
  const demand =
    femaleStockOf(world, ctx, homeSettlers(world, ctx, player)) + bookedBirths(world, player).daughters;
  bySeat.set(player, { version: world.mutationVersion, content: ctx.content, demand });
  return demand;
}

/** One seat's {@link femaleDemand}, kept until the next mutation of the world: a decision's housing steps
 *  and its fisher target ask several times. Derived read-state, never hashed. */
interface HeldDemand {
  readonly version: number;
  readonly content: SystemContext['content'];
  readonly demand: number;
}

const demands = new WeakMap<World, Map<number, HeldDemand>>();

/** The seat's child orders the assistant booked and a mother still carries, by the child's sex. */
export function bookedBirths(world: World, player: number): { daughters: number; sons: number } {
  const booked = { daughters: 0, sons: 0 };
  for (const e of world.query(AssistantChildOrder)) {
    if (ownerOf(world, e) !== player) continue;
    if (world.get(e, AssistantChildOrder).sex === 'female') booked.daughters++;
    else booked.sons++;
  }
  return booked;
}
