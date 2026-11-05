import type { BuildingType } from '@open-northland/data';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled } from '../../progression/index.js';
import { sourcedTiers } from './bill-sources.js';
import { directTier } from './direct-tier.js';
import type { BuildOrderEntry } from './entries.js';
import { towerUpgradeWaits } from './front.js';
import { housingPick } from './housing.js';
import { placementPassesOver, placementSpot, siteCommand } from './placement.js';
import { coverageOf, coverageSpotSearch, firstUncovered, type TowerCoverage } from './tower-coverage.js';
import { towerPlan, towerSpot, towerToUpgrade } from './tower-defence.js';
import { suppliedUpgrade } from './upgrade-supply.js';

/**
 * What a line makes of an unmet step this decision. A serving placement with no room beside what it
 * serves, a grass building with no grass left for it, or a coverage step with no target it can cover, is
 * passed over: the workshop still runs, slower, and the goods still travel, only farther, while a stalled
 * line would not, and gatherers felling trees free no grass where the map has none. A passed-over step holds neither its line nor the lanes and moves neither
 * the frontier nor the stall record. Every other unmet step acts, carrying the placement its search found
 * when it is one of those kinds.
 */
export type Verdict =
  | { readonly kind: 'pass' }
  | { readonly kind: 'act'; readonly placement: PlayerCommand | null };

export const ACTS: Verdict = { kind: 'act', placement: null };

export const PASSED_OVER: Verdict = { kind: 'pass' };

/** Whether an unmet `entry` is one its line passes over rather than stalls on when its search finds
 *  nothing. */
export function passesOver(ctx: SystemContext, entry: BuildOrderEntry): boolean {
  if (entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') return true;
  return entry.kind === 'place' && placementPassesOver(ctx, entry);
}

export function searchVerdict(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number | undefined,
  entry: BuildOrderEntry,
  underFire: EnemyFire,
  reserveGrass: boolean,
  made: () => ReadonlySet<number>,
): Verdict {
  if (tribe === undefined) return ACTS;
  switch (entry.kind) {
    case 'place': {
      if (!placementPassesOver(ctx, entry)) return ACTS;
      const type = directTier(world, ctx, player, owned, tribe, entry, made);
      if (type === undefined) return ACTS;
      const spot = placementSpot(
        world,
        ctx,
        terrain,
        player,
        owned,
        anchor,
        type,
        tribe,
        entry,
        underFire,
        reserveGrass,
      );
      return spot === null ? PASSED_OVER : { kind: 'act', placement: siteCommand(type, spot, tribe, player) };
    }
    case 'towerCoverage':
    case 'storeCoverage': {
      const placed = coverageCommand(
        world,
        ctx,
        terrain,
        player,
        owned,
        anchor,
        tribe,
        entry,
        underFire,
        reserveGrass,
        made,
      );
      return placed === null ? PASSED_OVER : { kind: 'act', placement: placed };
    }
    case 'upgrade':
    case 'collector':
    case 'housing':
      return ACTS;
  }
}

/** The housing lane's next site ({@link housingPick}) as a command, or null when it has none. */
export function housingCommand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'housing' }>,
  underFire: EnemyFire,
  decision: { readonly reserveGrass: boolean; readonly made: () => ReadonlySet<number> },
): PlayerCommand | null {
  const pick = housingPick(
    world,
    ctx,
    terrain,
    player,
    owned,
    anchor,
    tribe,
    entry,
    underFire,
    decision.reserveGrass,
    decision.made,
  );
  if (pick === null) return null;
  if (pick.kind === 'upgrade')
    return { kind: 'upgradeBuilding', building: pick.building, target: pick.target };
  return siteCommand(pick.type, pick.spot, tribe, player);
}

/**
 * The site a coverage entry raises next, or null when no target has a legal spot: a tower ring's
 * ({@link towerCommand}), or a store ring's first target with one, in target order, a flag beyond the
 * seat's build reach or ground another store already serves passed over, at the tier {@link directTier}
 * picks. Nothing while the entry's own tier is not enabled yet.
 */
export function coverageCommand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number,
  entry: Extract<BuildOrderEntry, { kind: 'towerCoverage' | 'storeCoverage' }>,
  underFire: EnemyFire,
  reserveGrass: boolean,
  made: () => ReadonlySet<number>,
): PlayerCommand | null {
  const base = buildingTypeByContentId(ctx.content, entry.building);
  if (base === undefined) return null; // unreachable after 'skip', kept for the type system
  if (!buildingEnabled(world, ctx, player, tribe, base.typeId)) return null;
  const lowerTier = entry.kind === 'towerCoverage' && entry.lowerTier === true;
  const type = lowerTier ? base : (directTier(world, ctx, player, owned, tribe, entry, made) ?? base);
  const coverage = coverageOf(world, ctx, player, entry);
  if (coverage.by === 'tower')
    return towerCommand(world, ctx, terrain, player, owned, tribe, base, type, coverage, underFire, {
      reserveGrass,
      made,
      lifts: !lowerTier,
    });
  const spotFor = coverageSpotSearch(
    world,
    ctx,
    terrain,
    player,
    owned,
    anchor,
    type,
    tribe,
    coverage,
    underFire,
    reserveGrass,
  );
  const spot = firstUncovered(world, ctx, player, owned, coverage, spotFor);
  return spot === null ? null : siteCommand(type, spot, tribe, player);
}

/** A short tower ring's next command (`./tower-defence.ts`): the upgrade of a lower tower that lifts its
 *  defence, while the ring `lifts` towers and the seat may start one, else a new tower of `type` where it
 *  lifts the lowest covered target most. */
export function towerCommand(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  tribe: number,
  base: BuildingType,
  type: BuildingType,
  coverage: TowerCoverage,
  underFire: EnemyFire,
  decision: {
    readonly reserveGrass: boolean;
    readonly made: () => ReadonlySet<number>;
    readonly lifts: boolean;
  },
): PlayerCommand | null {
  const plan = towerPlan(world, ctx, player, owned, coverage);
  if (plan === null || plan.short.length === 0) return null;
  const upper =
    !decision.lifts || base.upgradeTarget === undefined
      ? undefined
      : contentIndex(ctx.content).buildings.get(base.upgradeTarget);
  if (
    upper !== undefined &&
    buildingEnabled(world, ctx, player, tribe, upper.typeId) &&
    !towerUpgradeWaits(world, ctx, player, upper.id)
  ) {
    const candidate = towerToUpgrade(world, ctx, owned, plan, upper);
    const tiers = candidate === null ? [] : sourcedTiers(world, ctx, player, [upper.typeId], decision.made);
    const reach =
      candidate === null ? undefined : suppliedUpgrade(world, ctx, player, owned, candidate, tiers);
    if (candidate !== null && reach !== undefined)
      return { kind: 'upgradeBuilding', building: candidate, target: reach };
  }
  const spot = towerSpot(world, ctx, terrain, player, plan, type, tribe, underFire, decision.reserveGrass);
  return spot === null ? null : siteCommand(type, spot, tribe, player);
}
