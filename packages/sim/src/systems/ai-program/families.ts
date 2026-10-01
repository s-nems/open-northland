import type { MapAiSeat } from '@open-northland/data';
import { ChildOrder, Female, Residence, Settler, Stockpile } from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { goodTypeByContentId } from '../ai-player/content-lookup.js';
import { ownedSettlers } from '../ai-player/seat-roster.js';
import type { SystemContext } from '../context.js';
import { isAdultSettler, mayMarry } from '../family/eligibility.js';
import { mayBearChild } from '../orders/family.js';
import { isFighterJob } from '../readviews/index.js';

/** The civilian men a seat breeds towards when its script sets no `AI_UnitLimit`. Original behavior. */
export const DEFAULT_UNIT_LIMIT = 80;
/** The good a home must hold more than {@link HOME_FOOD_FOR_CHILD} of before its wife has a child. */
const HOME_FOOD_GOOD_ID = 'food_simple';
const HOME_FOOD_FOR_CHILD = 2;
/** A daughter is ordered while the adult women number fewer than the civilian men over this. */
const MEN_PER_WOMAN = 3;

/**
 * The scripted handler's family pass (original behavior): every single woman is sent to marry, and every
 * wife at home with food in the larder has a child while the seat's civilian men stay under the script's
 * unit limit and its whole people under the max unit limit (0 for none). The child is a girl while women
 * number under a third of the civilian men, else a boy, and a girl ends the pass, so at most one is
 * ordered a turn. The marriages here go out before any child and only as many as there are single men;
 * the original orders both in one walk over its women.
 */
export function familyOrders(
  world: World,
  ctx: SystemContext,
  seat: number,
  script: MapAiSeat | undefined,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const settlers = ownedSettlers(world, seat);
  let people = 0;
  let civilianMen = 0;
  let women = 0;
  let singleMen = 0;
  const singleWomen: Entity[] = [];
  const wives: Entity[] = [];
  for (const e of settlers) {
    people++;
    if (!isAdultSettler(world, e)) continue;
    if (!world.has(e, Female)) {
      if (!isFighterJob(ctx.content, world.get(e, Settler).jobType)) civilianMen++;
      if (mayMarry(world, ctx.content, e)) singleMen++;
      continue;
    }
    women++;
    if (mayMarry(world, ctx.content, e)) singleWomen.push(e);
    else if (world.has(e, Residence) && !world.has(e, ChildOrder) && mayBearChild(world, e)) wives.push(e);
  }
  // Capped by the single men, so the log does not fill with orders that would only auto-cancel.
  for (const woman of singleWomen.slice(0, singleMen)) commands.push({ kind: 'marry', entity: woman });

  const limit = script?.unitLimit ?? DEFAULT_UNIT_LIMIT;
  const cap = script?.maxUnitLimit ?? 0;
  if (civilianMen >= limit || (cap !== 0 && people >= cap)) return commands;
  const food = goodTypeByContentId(ctx.content, HOME_FOOD_GOOD_ID)?.typeId;
  if (food === undefined) return commands;
  const child = women < Math.trunc(civilianMen / MEN_PER_WOMAN) ? 'female' : 'male';
  for (const wife of wives) {
    const home = world.tryGet(wife, Residence)?.home;
    const larder = home === undefined ? undefined : world.tryGet(home, Stockpile)?.amounts.get(food);
    if ((larder ?? 0) <= HOME_FOOD_FOR_CHILD) continue;
    commands.push({ kind: 'makeChild', entity: wife, child });
    if (child === 'female') break;
  }
  return commands;
}
