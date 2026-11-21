import { dropPapersExcept, type Paper, setPapersEnabled } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { HEADQUARTERS_BUILDING_ID } from '../readviews/index.js';

/**
 * Allow or ban papers for every player. A ban takes each held paper but one that places the
 * headquarters, so a seat a map starts as a colony can still found it; while it holds, no paper lands.
 */
export function setPaperRule(world: World, ctx: SystemContext, enabled: boolean): void {
  setPapersEnabled(world, enabled);
  if (enabled) return;
  const buildings = contentIndex(ctx.content).buildings;
  const placesHeadquarters = (paper: Paper): boolean =>
    (paper.kind === 'placeHouse' || paper.kind === 'placeStockedHouse') &&
    buildings.get(paper.param)?.id === HEADQUARTERS_BUILDING_ID;
  dropPapersExcept(world, placesHeadquarters);
}
