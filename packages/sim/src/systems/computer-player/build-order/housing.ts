import type { BuildingType, ContentSet } from '@open-northland/data';
import { Building, type GoodsLine, UnderConstruction, Upgrading } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId, tiersAtOrAbove } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { isBuilt } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled } from '../../progression/index.js';
import { femaleDemand } from '../female-stock.js';
import { billSourced } from './bill-sources.js';
import type { BuildOrderEntry } from './entries.js';
import { placementSpot } from './placement.js';
import { suppliedUpgrade } from './upgrade-supply.js';

type HousingEntry = Extract<BuildOrderEntry, { kind: 'housing' }>;

/** Family slots the housing lane keeps free beyond the seat's female demand (authored): one for the next
 *  daughter the assistant books, one more for the one after while the next home rises. */
export const HOUSING_FREE_SLOTS = 2;

/** The home tiers `entry`'s lane raises: its base tier and every tier above it; none when the content
 *  lacks the base. */
export function homeTiersOf(content: ContentSet, entry: HousingEntry): ReadonlySet<number> {
  const base = buildingTypeByContentId(content, entry.building);
  return base === undefined ? new Set() : tiersAtOrAbove(contentIndex(content), base);
}

/** The seat's homes on `entry`'s chain, canonical ascending. */
function homesOf(world: World, ctx: SystemContext, owned: readonly Entity[], entry: HousingEntry): Entity[] {
  const tiers = homeTiersOf(ctx.content, entry);
  return owned.filter((e) => tiers.has(world.get(e, Building).buildingType));
}

/**
 * Whether the family slots the seat's homes will hold, a site counted at the tier it is becoming, fall
 * short of its women, girls and booked daughters ({@link femaleDemand}) plus {@link HOUSING_FREE_SLOTS}.
 * The population module books daughters only up to the built homes' slots, so the lane keeps them ahead.
 */
export function housingShort(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  entry: HousingEntry,
): boolean {
  const index = contentIndex(ctx.content);
  let slots = 0;
  for (const e of homesOf(world, ctx, owned, entry)) {
    const tier = world.tryGet(e, Upgrading)?.target ?? world.get(e, Building).buildingType;
    slots += index.buildings.get(tier)?.homeSize ?? 0;
  }
  return slots < femaleDemand(world, ctx, player) + HOUSING_FREE_SLOTS;
}

/** What the housing lane raises next: an upgrade of a built home, or a new home of a tier at a spot. */
export type HousingPick =
  | { readonly kind: 'upgrade'; readonly building: Entity; readonly target: number }
  | { readonly kind: 'place'; readonly type: BuildingType; readonly spot: HalfCellNode };

/** What a way to add family slots costs, in bill units, and the slots it adds. */
interface Price {
  readonly cost: number;
  readonly slots: number;
}

interface Option<T> extends Price {
  readonly pick: T;
}

function cheaper(a: Price, b: Price | null): boolean {
  return b === null || a.cost * b.slots < b.cost * a.slots;
}

function billUnits(bill: readonly GoodsLine[]): number {
  let units = 0;
  for (const line of bill) units += line.amount;
  return units;
}

/**
 * The cheapest family slot the seat can build now, by bill units per slot gained (authored approximation:
 * every good weighs one unit): an upgrade of a built home to any enabled tier above it whose bill the store
 * backs ({@link suppliedUpgrade}), or, below `entry.count` homes, a new home of any enabled tier whose
 * merged bill has a source ({@link billSourced}), beside the seat's homes. A tie goes to the upgrade, which
 * needs no room, then to the higher tier. A new home with no spot yields to the best upgrade, so a cramped
 * seat grows its homes upward. Null when nothing can be raised.
 */
export function housingPick(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number,
  entry: HousingEntry,
  underFire: EnemyFire,
  reserveGrass: boolean,
  made: () => ReadonlySet<number>,
): HousingPick | null {
  const index = contentIndex(ctx.content);
  const homes = homesOf(world, ctx, owned, entry);
  let upgrade: Option<HousingPick> | null = null;
  // Homes of one type offer the same upgrades, so only the lowest-id built one of each is asked.
  const asked = new Set<number>();
  for (const home of homes) {
    const building = world.get(home, Building);
    if (!isBuilt(world, home) || world.has(home, UnderConstruction) || asked.has(building.buildingType))
      continue;
    asked.add(building.buildingType);
    const from = index.buildings.get(building.buildingType);
    if (from === undefined) continue;
    const seen = new Set<number>();
    for (let tier = from.upgradeTarget; tier !== undefined && !seen.has(tier); ) {
      seen.add(tier);
      const to = index.buildings.get(tier);
      if (to === undefined || !buildingEnabled(world, ctx, player, building.tribe, tier)) break;
      const bill = index.upgradeBillByTarget.get(from.typeId)?.get(tier);
      const option = {
        pick: { kind: 'upgrade', building: home, target: tier } as const,
        cost: bill === undefined ? 0 : billUnits(bill),
        slots: to.homeSize - from.homeSize,
      };
      if (
        bill !== undefined &&
        option.slots > 0 &&
        cheaper(option, upgrade) &&
        suppliedUpgrade(world, ctx, player, owned, home, [tier]) === tier
      )
        upgrade = option;
      tier = to.upgradeTarget;
    }
  }

  let place: Option<BuildingType> | null = null;
  if (homes.length < entry.count) {
    const types = [...homeTiersOf(ctx.content, entry)]
      .flatMap((id) => index.buildings.get(id) ?? [])
      .sort((a, b) => b.homeSize - a.homeSize);
    for (const type of types) {
      if (type.homeSize <= 0 || !buildingEnabled(world, ctx, player, tribe, type.typeId)) continue;
      const option = {
        pick: type,
        cost: billUnits(index.constructionBillByBuilding.get(type.typeId) ?? []),
        slots: type.homeSize,
      };
      const step: BuildOrderEntry = { kind: 'place', building: type.id, count: 1 };
      if (cheaper(option, place) && billSourced(world, ctx, player, step, made)) place = option;
    }
  }

  if (place !== null && (upgrade === null || cheaper(place, upgrade))) {
    const near: Extract<BuildOrderEntry, { kind: 'place' }> = {
      kind: 'place',
      building: place.pick.id,
      count: 1,
      near: [{ kind: 'building', id: entry.building }],
    };
    const spot = placementSpot(
      world,
      ctx,
      terrain,
      player,
      owned,
      anchor,
      place.pick,
      tribe,
      near,
      underFire,
      reserveGrass,
    );
    if (spot !== null) return { kind: 'place', type: place.pick, spot };
  }
  return upgrade?.pick ?? null;
}
