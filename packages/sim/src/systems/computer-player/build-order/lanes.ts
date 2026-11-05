import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import type { LineStatuses } from './order/entries.js';
import { type BuildLine, type BuildLineId, type BuildOrderEntry, isLaneEntry } from './order/entries.js';
import { homeTiersOf } from './steps/housing.js';
import { coverageLaneSites } from './towers/tower-coverage.js';

/** One lane of a line ({@link isLaneEntry}) and the sites of its building the seat has open. */
export interface OpenLane {
  readonly line: BuildLineId;
  readonly step: number;
  readonly entry: Extract<BuildOrderEntry, { kind: 'towerCoverage' | 'storeCoverage' | 'housing' }>;
  readonly sites: number;
  /** A housing lane opened ahead of its place in the line on a food-rich seat. */
  readonly early: boolean;
}

/** The lanes the lines have reached, in line priority and step order: every step before each in its line
 *  but the gatherer steps stands met or passed over, and the clock has reached the lane's `fromTick`; a housing lane also opens
 *  ahead of that while `housingEarly` holds. A lane's sites are the open sites of its building or a tier
 *  above it, whichever step placed them. */
export function openLanes(
  world: World,
  ctx: SystemContext,
  lines: readonly BuildLine[],
  statuses: LineStatuses,
  sites: readonly Entity[],
  passedOver: (line: BuildLine, step: number) => boolean,
  housingEarly: () => boolean,
): OpenLane[] {
  const lanes: OpenLane[] = [];
  for (const line of lines) {
    let reached = true;
    for (const [step, entry] of line.steps.entries()) {
      if (
        entry.kind === 'housing' ||
        ((entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') && entry.lane === true)
      ) {
        const early = !reached && entry.kind === 'housing' && housingEarly();
        if (!reached && !early) continue;
        const fromTick = entry.kind === 'housing' ? 0 : (entry.fromTick ?? 0);
        if (ctx.tick < fromTick) continue;
        const chain = laneTiers(ctx, entry);
        const own = sites.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
        lanes.push({ line: line.id, step, entry, sites: own, early });
        continue;
      }
      // A gatherer step holds the line's sites, never its lanes: the workforce fills it out of spare men,
      // which a seat of few men may not have for an hour.
      if (entry.kind === 'collector') continue;
      if (reached && statuses.get(line.id)?.[step] === 'unmet' && !passedOver(line, step)) reached = false;
    }
  }
  return lanes;
}

/** Whether a coverage lane holding `own` sites may open another: its first always, more up to its
 *  {@link coverageLaneSites} while the seat's `paced` sites still leave the lines one of the `siteCap`. */
export function laneSiteOpen(
  world: World,
  ctx: SystemContext,
  player: number,
  entry: Extract<OpenLane['entry'], { kind: 'towerCoverage' | 'storeCoverage' }>,
  own: number,
  paced: number,
  siteCap: number,
): boolean {
  if (own === 0) return true;
  return own < coverageLaneSites(world, ctx, player, entry) && paced + 1 < siteCap;
}

/** The building types whose sites a lane counts as its own: its building and the tiers above it, or the
 *  housing lane's whole home chain. */
export function laneTiers(ctx: SystemContext, entry: OpenLane['entry']): ReadonlySet<number> {
  if (entry.kind === 'housing') return homeTiersOf(ctx.content, entry);
  const type = buildingTypeByContentId(ctx.content, entry.building);
  return type === undefined ? new Set() : tiersAtOrAbove(contentIndex(ctx.content), type);
}
