import type { BuildingType } from '@open-northland/data';
import { contentIndex } from '../../core/content-index.js';
import type { SystemContext } from '../context.js';

// The home level-chain read model. Its tribe-wide housing/population tallies are terminal HUD projections
// and live in ../readviews/hud.ts; what stays here is the chain step the ConstructionSystem's upgrade
// trigger and ./capacity.ts's delivery demand both run on.

/**
 * The next tier in a `home`'s level chain, or undefined if `type` is not a `home` or is the top tier.
 *
 * The home level chain is the consecutive typeIds `home_level_00..04` (typeIds 2..6 in the real data),
 * each a distinct `home`-kind {@link BuildingType} carrying its OWN per-level `construction` cost and a
 * larger `homeSize`. So the next tier is the building type at `typeId + 1`, provided that type exists
 * AND is itself a `home` (the chain is contiguous; the type just past the chain's top, `home_level_04`,
 * is not a home, so a top-tier home has no next tier). Reading the chain off the consecutive typeId
 * keeps the upgrade purely data-driven — there is no separate "next level" pointer in the source; the
 * `home level NN` typeIds are sequential by construction.
 *
 * Cross-system: the ConstructionSystem uses it as the home level-up trigger (next tier's materials
 * present → upgrade), and {@link stockCapacity} uses it so a still-upgradable home advertises the next
 * tier's cost as carrier-delivery demand.
 */
export function homeNextTier(type: BuildingType, ctx: SystemContext): BuildingType | undefined {
  if (type.kind !== 'home') return undefined;
  const next = contentIndex(ctx.content).buildings.get(type.typeId + 1);
  return next?.kind === 'home' ? next : undefined;
}
