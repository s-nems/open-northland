import { Building, Position } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { manhattan } from '../../../spatial.js';
import { isTemple } from '../../../stores/index.js';
import { closer } from '../nearest.js';
import { interactionCell } from '../workplaces.js';

/**
 * The nearest {@link isTemple temple} a devout settler should walk to in order to pray, by Manhattan
 * distance from `here`, ascending-cell-id tie-break, scanned in canonical entity-id order. Returns the
 * temple entity or null if no temple exists. This is the piety need's satisfier→building-target lookup
 * — the genuinely-new piece a target-bound need introduces (eat resolves to a store, sleep to no site;
 * pray resolves to a specific building the settler must reach).
 */
export function nearestTemple(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  for (const e of candidates) {
    if (!world.has(e, Building) || !world.has(e, Position)) continue;
    if (!isTemple(world, ctx, e)) continue;
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * The nearest **construction site** a builder of `tribe` should raise — a {@link Building} still marked
 * {@link UnderConstruction} (a placed foundation being built up), by Manhattan distance from `here` with
 * an ascending-cell-id tie-break, scanned in canonical entity-id order (so the winner never depends on
 * store insertion history). Returns the site entity or null if the tribe has no site under construction.
 * The builder drive walks here to hammer it, or — when the site has no material left to install — fetches
 * a missing construction good for it. Scans the {@link TargetCandidates.constructionSites} list — only the
 * sites still under construction — so with no foundations in progress the scan is O(0) however many
 * finished buildings stand, and a builder cohort never walks the whole building list to find nothing.
 */
export function nearestConstructionSite(
  candidates: readonly Entity[],
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  tribe: number,
): Entity | null {
  let best: Entity | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestCell = Number.POSITIVE_INFINITY;
  // `candidates` is the construction-site list (UnderConstruction + Building + Position guaranteed by
  // collectTargets), so only the tribe filter remains — no per-entity marker re-check.
  for (const e of candidates) {
    if (world.get(e, Building).tribe !== tribe) continue; // another tribe's site
    const cell = interactionCell(world, ctx, terrain, e, here);
    const dist = manhattan(terrain, here, cell);
    if (closer(dist, cell, bestDist, bestCell)) {
      best = e;
      bestDist = dist;
      bestCell = cell;
    }
  }
  return best;
}
