import type { BuildingType } from '@open-northland/data';
import { BUILDING_KIND } from '@open-northland/data';
import { type Paper, playerPaperSlots, playerPlacementTribes } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { buildingTypeByContentId, countedTiers, tiersAtOrAbove } from '../../../ai-shared/content-lookup.js';
import { anchorNodeOf } from '../../../ai-shared/node-geometry.js';
import { seatPlacementProbe } from '../../../conflict/contested-ground.js';
import type { SystemContext } from '../../../context.js';
import { grassReserved } from '../ground/grass-reserve.js';
import { type PlaceCommand, placementSpot, siteCommand } from '../ground/placement.js';
import type { LineStatuses } from '../order/entries.js';
import {
  type BuildLine,
  type BuildLineId,
  type BuildOrder,
  type BuildOrderEntry,
  isLaneEntry,
  linesByPriority,
} from '../order/entries.js';
import { type Siege, seatSiege } from '../towers/siege.js';
import { coverageSpotSearch, firstUncovered } from '../towers/tower-coverage.js';
import { awaitingRebuild } from './frontier.js';
import { homeTiersOf } from './housing.js';
import { keyedStatuses, StalledSearches } from './stalled-searches.js';

type PlacingEntry = Extract<
  BuildOrderEntry,
  { kind: 'place' | 'towerCoverage' | 'storeCoverage' | 'housing' }
>;

/** The tiers a placing step counts toward itself: its chain from its building up, a `place` step's
 *  stopping below its `belowTier`. */
export function stepTiers(ctx: SystemContext, entry: PlacingEntry): ReadonlySet<number> {
  if (entry.kind === 'housing') return homeTiersOf(ctx.content, entry);
  const base = buildingTypeByContentId(ctx.content, entry.building);
  if (base === undefined) return new Set();
  return entry.kind === 'place'
    ? countedTiers(ctx.content, base, entry.belowTier)
    : tiersAtOrAbove(contentIndex(ctx.content), base);
}

function billUnits(ctx: SystemContext, typeId: number): number {
  let units = 0;
  for (const line of contentIndex(ctx.content).constructionBillByBuilding.get(typeId) ?? [])
    units += line.amount;
  return units;
}

/** The dearest merged bill, in units, of any tier a placing step of `order` counts: the building an
 *  any-building paper is kept for. */
function dearestPlacedBill(ctx: SystemContext, order: BuildOrder): number {
  let dearest = 0;
  for (const line of order.lines) {
    for (const entry of line.steps) {
      if (entry.kind === 'upgrade' || entry.kind === 'collector') continue;
      for (const tier of stepTiers(ctx, entry)) dearest = Math.max(dearest, billUnits(ctx, tier));
    }
  }
  return dearest;
}

/**
 * `command` spending one of the seat's placing papers, the building then standing finished at once, or
 * `command` itself when no paper fits. A paper naming a tier of the step's chain at or above the chosen one
 * wins, the highest first; else an any-building paper goes on a tier whose merged bill is the dearest any
 * placing step of the seat's order raises (owner ruling: a free plan goes on the most expensive building).
 * A tier other than the chosen one is used only where its footprint fits the spot found for the chosen one.
 */
export function paperedPlacement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  order: BuildOrder,
  command: PlaceCommand,
  counted: ReadonlySet<number>,
): PlaceCommand {
  const slots = playerPaperSlots(world, player);
  if (slots.length === 0) return command;
  const chosen = contentIndex(ctx.content).buildings.get(command.buildingType);
  if (chosen === undefined) return command;
  const tiers = [...tiersAtOrAbove(contentIndex(ctx.content), chosen)]
    .filter((tier) => tier === chosen.typeId || counted.has(tier))
    .reverse();
  const fits = (tier: number): boolean =>
    tier === command.buildingType ||
    seatPlacementProbe(world, ctx.content, terrain, ctx.fog, tier, command.tribe, player).canPlace(
      command.x,
      command.y,
    );
  const spend = (tier: number, paper: Paper): PlaceCommand => ({ ...command, buildingType: tier, paper });

  for (const tier of tiers) {
    const named =
      slots.find(
        (s) => s !== null && (s.kind === 'placeHouse' || s.kind === 'placeStockedHouse') && s.param === tier,
      ) ?? null;
    if (named !== null && fits(tier)) return spend(tier, named);
  }
  const any = slots.find((s) => s !== null && s.kind === 'placeAny') ?? null;
  if (any === null) return command;
  const dearest = dearestPlacedBill(ctx, order);
  for (const tier of tiers) {
    if (billUnits(ctx, tier) >= dearest && fits(tier)) return spend(tier, any);
  }
  return command;
}

function namesHouse(slot: Paper | null): slot is Paper {
  return slot !== null && (slot.kind === 'placeHouse' || slot.kind === 'placeStockedHouse');
}

/** Whether the seat holds a paper naming the house it places. */
export function holdsNamedPaper(world: World, player: number): boolean {
  return playerPaperSlots(world, player).some(namesHouse);
}

/** A `place` step of `order` a named paper the seat holds covers, with the paper and the tier it names. */
export interface PaperedStep {
  readonly line: BuildLine;
  readonly step: number;
  readonly entry: Extract<BuildOrderEntry, { kind: 'place' }>;
  readonly tier: number;
  readonly paper: Paper;
}

/**
 * The unmet `place` steps a named paper covers, in line priority, each line walked from its start up to its
 * first unmet step no paper covers (a collector or a lane never stops the walk): a papered building stands
 * finished at once, so it waits on no turn, site, hold, bill or discovery, and the steps behind it, placed
 * near it, find it standing. Owner ruling: a map that hands the seat papers for its production line means it
 * to stand at the start, its given craftsmen at work. The highest tier a paper names wins.
 */
export function* paperedSteps(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  statuses: LineStatuses,
): Generator<PaperedStep> {
  const named = playerPaperSlots(world, player).filter(namesHouse);
  if (named.length === 0) return;
  for (const line of linesByPriority(order)) {
    const lineStatus = statuses.get(line.id) ?? [];
    for (const [step, entry] of line.steps.entries()) {
      if (isLaneEntry(entry) || entry.kind === 'collector' || lineStatus[step] !== 'unmet') continue;
      if (entry.kind !== 'place') break;
      // The chain runs from the step's building up, so the walk from its end meets the highest tier first.
      const tiers = [...stepTiers(ctx, entry)].reverse();
      let covered: { readonly tier: number; readonly paper: Paper } | null = null;
      for (const tier of tiers) {
        const paper = named.find((p) => p.param === tier);
        if (paper !== undefined) {
          covered = { tier, paper };
          break;
        }
      }
      // A `lockPasses` step never holds its line, so an unpapered one leaves the walk going.
      if (covered === null) {
        if (entry.lockPasses === true) continue;
        break;
      }
      yield { line, step, entry, ...covered };
    }
  }
}

/** A store-coverage step of `order` still short of a store, with the warehouse a named paper raises. */
export interface PaperedStore {
  readonly line: BuildLine;
  readonly step: number;
  readonly entry: Extract<BuildOrderEntry, { kind: 'storeCoverage' }>;
  readonly type: BuildingType;
  readonly paper: Paper;
}

/**
 * The first unmet `storeCoverage` step with the first warehouse paper the seat holds, or null. A warehouse
 * has no `place` step and a coverage step comes late at its own tier, so such a paper would lie unspent
 * while the seat pays for the sites: observed on arabskie_wyspy_wolna_gra_mieszana, a seat's papers lay
 * unused into the late game. A paper is free and stands finished, so it goes down at once, on any tier.
 */
export function paperedStore(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  statuses: LineStatuses,
): PaperedStore | null {
  const buildings = contentIndex(ctx.content).buildings;
  for (const paper of playerPaperSlots(world, player).filter(namesHouse)) {
    const type = buildings.get(paper.param);
    if (type?.kind !== BUILDING_KIND.storage) continue;
    for (const line of linesByPriority(order)) {
      const lineStatus = statuses.get(line.id) ?? [];
      for (const [step, entry] of line.steps.entries())
        if (entry.kind === 'storeCoverage' && lineStatus[step] === 'unmet')
          return { line, step, entry, type, paper };
    }
  }
  return null;
}

/** The placement spending a named paper on the first step {@link paperedSteps} finds a spot for, a line
 *  whose papered step finds none passing to the next line, else a warehouse paper ({@link paperedStore})
 *  where the seat's store coverage is short; null under attack or with nothing to place. */
export function paperedOpening(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  base: Entity,
  order: BuildOrder,
  statuses: LineStatuses,
): PlaceCommand | null {
  const tribe = playerPlacementTribes(world, player)?.[0];
  const anchor = anchorNodeOf(world, base);
  if (tribe === undefined || anchor === null) return null;
  const searches = new StalledSearches(world, player, keyedStatuses(order, statuses));
  let siege: Siege | null = null;
  let reserveGrass: boolean | undefined;
  const stalledLines = new Set<BuildLineId>();
  for (const { line, step, entry, tier, paper } of paperedSteps(world, ctx, player, order, statuses)) {
    if (stalledLines.has(line.id) || searches.waits(line.id, step, ctx.tick)) {
      stalledLines.add(line.id);
      continue;
    }
    const type = contentIndex(ctx.content).buildings.get(tier);
    if (type === undefined) continue;
    siege ??= seatSiege(world, ctx, terrain, player, owned);
    if (siege.attacked) return null;
    if (awaitingRebuild(world, player, line.id, step, entry, ctx.tick)) {
      stalledLines.add(line.id);
      continue;
    }
    reserveGrass ??= grassReserved(ctx, terrain, anchor, order, statuses);
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
      siege.underFire,
      reserveGrass,
    );
    searches.searched(line.id, step, ctx.tick, spot !== null, true);
    if (spot === null) {
      stalledLines.add(line.id);
      continue;
    }
    searches.acting(line.id, step);
    return { ...siteCommand(type, spot, tribe, player), paper };
  }
  const store = paperedStore(world, ctx, player, order, statuses);
  if (store === null || searches.waits(store.line.id, store.step, ctx.tick)) return null;
  siege ??= seatSiege(world, ctx, terrain, player, owned);
  if (siege.attacked) return null;
  reserveGrass ??= grassReserved(ctx, terrain, anchor, order, statuses);
  const coverage = { by: 'store', radius: store.entry.radius } as const;
  const spot = firstUncovered(
    world,
    ctx,
    player,
    owned,
    coverage,
    coverageSpotSearch(
      world,
      ctx,
      terrain,
      player,
      owned,
      anchor,
      store.type,
      tribe,
      coverage,
      siege.underFire,
      reserveGrass,
    ),
  );
  searches.searched(store.line.id, store.step, ctx.tick, spot !== null, true);
  if (spot === null) return null;
  searches.acting(store.line.id, store.step);
  return { ...siteCommand(store.type, spot, tribe, player), paper: store.paper };
}
