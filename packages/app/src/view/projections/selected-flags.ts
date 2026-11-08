import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { buildSiteOf, rallyFlagOf, siteClaimBuilderOf, workFlagOf } from '../../game/snapshot/index.js';

/**
 * The flags the renderer highlights for the current selection: the work flags planted by the selected
 * gatherers, the flags of the wall or road sites the selected builders claimed, and the rally flag a
 * selected barracks stands at. Resolved through the selection rather than the world: a decoded map
 * holds tens of thousands of entities and a selection is a handful.
 */
export function selectedFlags(snapshot: WorldSnapshot, selected: ReadonlySet<number>): ReadonlySet<number> {
  const flags = new Set<number>();
  for (const id of selected) {
    const entity = entityById(snapshot, id);
    if (entity === undefined) continue;
    const flag = workFlagOf(entity);
    if (flag !== undefined) flags.add(flag);
    const rally = rallyFlagOf(entity);
    if (rally !== undefined) flags.add(rally);
    const site = buildSiteOf(entity);
    const siteEntity = site === undefined ? undefined : entityById(snapshot, site);
    if (site !== undefined && siteEntity !== undefined && siteClaimBuilderOf(siteEntity) === id)
      flags.add(site);
  }
  return flags;
}
