import { infoLinesOf } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { countGoodsInArea } from './goals/goods.js';
import {
  countAnimalsInArea,
  countHousesInArea,
  countHumansInArea,
  countSoldiersInArea,
} from './goals/proximity.js';

/** One of a player's set info lines as the display prints it: the string, the live count its first
 *  `%d` takes (zero for a plain string) and the `extra` its second one takes. */
export interface InfoLineView {
  readonly index: number;
  readonly stringId: number;
  readonly count: number;
  readonly extra: number;
}

/** The player's set info lines, ascending by line, each with its tally as of now. A read over the
 *  population per counting line, so a caller reads it once per tick. */
export function infoLines(world: World, ctx: ContentContext, player: number): InfoLineView[] {
  return infoLinesOf(world, player).map(({ index, line }) => {
    const { point, range } = line;
    let count = 0;
    switch (line.kind) {
      case 'text':
        break;
      case 'goods':
        count = countGoodsInArea(world, ctx, player, line.target, point, range);
        break;
      case 'houses':
        count = countHousesInArea(world, player, line.target, point, range);
        break;
      case 'humans':
        count = countHumansInArea(world, player, point, range);
        break;
      case 'soldiers':
        count = countSoldiersInArea(world, ctx, player, point, range);
        break;
      case 'animals':
        count = countAnimalsInArea(world, player, line.target, point, range);
        break;
    }
    return { index, stringId: line.stringId, count, extra: line.extra };
  });
}
