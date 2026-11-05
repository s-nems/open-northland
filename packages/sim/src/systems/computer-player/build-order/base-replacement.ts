import type { BuildingType } from '@open-northland/data';
import { Building, mapBriefOf, playerPlacementTribes } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import { anchorCentroid } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled } from '../../progression/index.js';
import { HEADQUARTERS_BUILDING_ID } from '../../readviews/index.js';
import { placementSpot, siteCommand } from './ground/placement.js';
import { BASE_REPLACEMENT_ENTRY, BASE_REPLACEMENT_IDS, BASELESS_CONSTRUCTION_SITES } from './order/limits.js';
import { billSourced, goodsMadeBy } from './supply/bill-sources.js';
import { seatSiege } from './towers/siege.js';

/** The first of {@link BASE_REPLACEMENT_IDS} the seat may raise and has a source for every good of its
 *  bill ({@link billSourced}), else the lowest tier the content has. */
export function baseReplacementType(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  tribe: number,
): BuildingType | undefined {
  let made: ReadonlySet<number> | undefined;
  const madeGoods = (): ReadonlySet<number> => (made ??= goodsMadeBy(world, ctx, owned));
  let lowest: BuildingType | undefined;
  for (const id of BASE_REPLACEMENT_IDS) {
    const type = buildingTypeByContentId(ctx.content, id);
    if (type === undefined) continue;
    lowest = type;
    const entry = { ...BASE_REPLACEMENT_ENTRY, building: id };
    if (
      buildingEnabled(world, ctx, player, tribe, type.typeId) &&
      billSourced(world, ctx, player, entry, madeGoods)
    )
      return type;
  }
  return lowest;
}

/** Where the seat's start headquarters stood, as the map brief recorded it, or null. */
export function startHeadquartersNode(world: World, ctx: SystemContext, player: number): HalfCellNode | null {
  const hq = buildingTypeByContentId(ctx.content, HEADQUARTERS_BUILDING_ID);
  if (hq === undefined) return null;
  const start = mapBriefOf(world)?.seats.find((seat) => seat.player === player);
  const record = start?.buildings.find((b) => b.buildingType === hq.typeId);
  return record === undefined ? null : { hx: record.hx, hy: record.hy };
}

/** A seat that holds buildings but no base rebuilds one where its start headquarters stood, else at the
 *  centroid of what stands (owner ruling: one warehouse in the headquarters' place). Every other step and
 *  lane waits meanwhile; the sites already open go on rising, and the warehouse is placed once, at most
 *  {@link BASELESS_CONSTRUCTION_SITES} store sites among `sites` open at a time. */
export function replaceMissingBase(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  sites: readonly Entity[],
): readonly PlayerCommand[] {
  const buildings = contentIndex(ctx.content).buildings;
  const storeSites = sites.filter(
    (e) => buildings.get(world.get(e, Building).buildingType)?.kind === 'storage',
  );
  if (storeSites.length >= BASELESS_CONSTRUCTION_SITES) return [];
  const tribe = playerPlacementTribes(world, player)?.[0];
  if (tribe === undefined) return [];
  const siege = seatSiege(world, ctx, terrain, player, owned);
  if (siege.attacked) return [];
  const centre = startHeadquartersNode(world, ctx, player) ?? anchorCentroid(world, owned);
  if (centre === null) return [];
  const type = baseReplacementType(world, ctx, player, owned, tribe);
  if (type === undefined) return []; // content without a warehouse expresses no replacement
  const spot = placementSpot(
    world,
    ctx,
    terrain,
    player,
    owned,
    centre,
    type,
    tribe,
    BASE_REPLACEMENT_ENTRY,
    siege.underFire,
    false,
  );
  if (spot === null) return [];
  return [siteCommand(type, spot, tribe, player)];
}
