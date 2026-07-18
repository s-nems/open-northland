import { Building, UnderConstruction } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { placementProbe } from '../footprint/index.js';
import type { AiPlayerModule } from './index.js';
import {
  anchorNodeOf,
  buildingTypeByContentId,
  firstRingNode,
  headquartersOf,
  ownedBuildings,
} from './shared.js';

/**
 * The HouseBuild module — a data-driven opening build order (genre convention: an authored list
 * executes before any demand logic; Widelands "basic economy" / KaM classic AI / AoE2 opening
 * books). The executor walks the ordered entries, keeps at most {@link MAX_ACTIVE_CONSTRUCTION_SITES}
 * sites open, and places each building on the free spot closest to the headquarters. A destroyed
 * building re-enters its entry's count, so the list self-repairs; an unmet entry with no legal spot
 * or no free site slot stalls (is retried next decision), never skipped. Builders are not pinned to
 * sites — the organic builder drive already picks the nearest site and fetches materials.
 */

/** One build-order step: place `count` buildings of the stable content id. A `home`-kind entry
 *  counts every owned home tier (an upgraded home must not trigger a replacement). */
export interface BuildOrderEntry {
  readonly building: string;
  readonly count: number;
}

/** The opening list (source: the user's authored plan, 2026-07-17). The pause after the well is
 *  deliberate — the next stage (house upgrades) needs further user input. */
export const DEFAULT_BUILD_ORDER: readonly BuildOrderEntry[] = [
  { building: 'work_farm_00', count: 1 },
  { building: 'home_level_00', count: 3 },
  { building: 'work_pottery_00', count: 1 },
  { building: 'work_mason_hut_00', count: 1 },
  { building: 'work_mill_00', count: 1 },
  { building: 'work_bakery_00', count: 1 },
  { building: 'work_well_00', count: 1 },
];

/** Concurrent construction sites per seat (user rule, 2026-07-18: exactly one site at a time). */
export const MAX_ACTIVE_CONSTRUCTION_SITES = 1;

/** How far from the headquarters the placement ring search reaches, in half-cell nodes — a bounded
 *  neighbourhood scan, never the whole map. Beyond it the executor stalls (expansion's concern). */
export const BUILD_SEARCH_MAX_RADIUS_NODES = 48;

/** A module executing `order` — parameterized so tests drive it with fixture content ids. */
export function buildOrderModule(order: readonly BuildOrderEntry[]): AiPlayerModule {
  return {
    id: 'houseBuild',
    run: (world, ctx, player) => runBuildOrder(world, ctx, player, order),
  };
}

function runBuildOrder(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly Command[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // a mapless sim has no ground to place on
  const hq = headquartersOf(world, ctx, player);
  if (hq === null) return [];
  const anchor = anchorNodeOf(world, hq);
  if (anchor === null) return [];

  const index = contentIndex(ctx.content);
  const owned = ownedBuildings(world, player);
  let sites = 0;
  for (const e of owned) {
    if (world.has(e, UnderConstruction)) sites++;
  }
  if (sites >= MAX_ACTIVE_CONSTRUCTION_SITES) return [];

  for (const entry of order) {
    const type = buildingTypeByContentId(ctx.content, entry.building);
    if (type === undefined) continue; // entry not in this content set
    let have = 0;
    for (const e of owned) {
      const ownedType = index.buildings.get(world.get(e, Building).buildingType);
      if (ownedType === undefined) continue;
      const matches = type.kind === 'home' ? ownedType.kind === 'home' : ownedType.typeId === type.typeId;
      if (matches) have++;
    }
    if (have >= entry.count) continue;

    // One placement per decision: the closest legal anchor to the HQ (ring order is canonical).
    // Occupied anchors are rejected explicitly so a footprint-less type (synthetic content, where
    // the probe accepts everything) still never stacks on an existing building.
    const occupied = new Set<string>();
    for (const e of world.query(Building)) {
      const node = anchorNodeOf(world, e);
      if (node !== null) occupied.add(`${node.hx},${node.hy}`);
    }
    const probe = placementProbe(world, ctx.content, terrain, type.typeId);
    const spot = firstRingNode(anchor.hx, anchor.hy, BUILD_SEARCH_MAX_RADIUS_NODES, (x, y) => {
      if (!terrain.inBounds(x, y) || !terrain.isBuildable(terrain.nodeAt(x, y))) return false;
      return !occupied.has(`${x},${y}`) && probe.canPlace(x, y);
    });
    if (spot === null) return []; // no space near home — stall, don't skip the entry
    return [
      {
        kind: 'placeBuilding',
        buildingType: type.typeId,
        x: spot.hx,
        y: spot.hy,
        tribe: world.get(hq, Building).tribe,
        owner: player,
        underConstruction: true,
      },
    ];
  }
  return []; // the opening list is satisfied — the module goes quiet
}
