import { type Paper, playerPaperSlots } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId, countedTiers, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import { seatPlacementProbe } from '../../conflict/contested-ground.js';
import type { SystemContext } from '../../context.js';
import type { BuildOrder, BuildOrderEntry } from './entries.js';
import { homeTiersOf } from './housing.js';

type PlaceCommand = Extract<PlayerCommand, { kind: 'placeBuilding' }>;
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
