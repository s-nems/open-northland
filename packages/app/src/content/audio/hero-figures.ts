import type { HeroFigure } from '@open-northland/audio';
import { systems } from '@open-northland/sim';
import { isFrankishHeroineSlot } from '../../catalog/jobs.js';
import type { ContentIr } from '../ir/rows.js';

/**
 * The hero jobs each tribe draws with the hero's own figure: those it authors a `[jobbasegraphics]`
 * record for. Any other hero of the tribe wears its class's soldier, and the Frankish heroine slot's
 * record is Santa Claus, so neither speaks with the hero's voice.
 */
export function heroFigures(ir: ContentIr): HeroFigure[] {
  const heroJobs = new Set<number>();
  for (const { typeId, id } of ir.jobs ?? []) {
    if (typeId !== undefined && id !== undefined && systems.isHeroJobRow({ id })) heroJobs.add(typeId);
  }
  return (ir.jobGraphics ?? [])
    .filter(({ tribe, job }) => heroJobs.has(job) && !isFrankishHeroineSlot(tribe, job))
    .map(({ tribe, job }) => ({ tribe, job }));
}
