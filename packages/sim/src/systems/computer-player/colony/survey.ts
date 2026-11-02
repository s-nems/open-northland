import {
  diplomacyStance,
  MAX_PLAYERS,
  type MapBriefView,
  mapBriefOf,
  playerPlacementTribes,
  zoneOfNode,
} from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistance } from '../../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { placementProbe } from '../../footprint/placement/building.js';
import { believedBuildings } from '../knowledge/intel/index.js';

// Where a seat could settle over the sea. The figures below are authored from a survey of the 65 free-play
// maps' zones unless they say otherwise: on arabskie_wyspy_wolna_gra_mieszana every seat keeps a site 99-122
// nodes from home, and only 7 maps pass these thresholds off a home land.

/** Zones the block reaches each way from its centre zone: 3x3, about a 96-node box. */
const BLOCK_REACH_ZONES = 1;
/** The least buildable ground, wood and stone a block holds. */
const MIN_FREE_NODES = 300;
const MIN_WOOD = 300;
const MIN_STONE = 150;
/** Deposit past these buys a site nothing: a colony sends home what its men dig in a game. */
const WOOD_SCORE_CAP = 900;
const STONE_SCORE_CAP = 600;
const STONE_SCORE_WEIGHT = 2;
const FISH_SCORE_DIVISOR = 4;
/** Score lost per hex node from home: a longer voyage costs line trips. */
const DISTANCE_SCORE_WEIGHT = 2;
/** The best sites the live test weighs, in score order. */
const LIVE_CANDIDATES = 8;

/** Owner ruling: a colony keeps clear of every seat it does not call friend. The figure is authored from the
 *  survey: hex nodes between a site's centre and the nearest start or believed building. */
export const COLONY_RANGE_NODES = 96;

/** The warehouse a colony founds on. */
export const COLONY_STORE_BUILDING_ID = 'stock_00';
/** The fewest spots for it the block must offer as the map stands now. */
const MIN_STORE_SPOTS = 300;

const WOOD_ID = 'wood';
const STONE_ID = 'stone';

/** A 3x3 zone block on one land the seat's ships can reach. */
export interface ColonySite {
  /** The block's centre zone, its identity. */
  readonly zone: number;
  readonly land: number;
  /** The centre zone's middle node. */
  readonly centre: HalfCellNode;
  readonly score: number;
  /** Another seat's start lies nearer: it weighs the same block, so this seat looks there last. */
  readonly contested: boolean;
}

const candidatesByBrief = new WeakMap<MapBriefView, Map<number, readonly ColonySite[]>>();

/** The zones of the block around `zone`, in row order, cut at the map's edge. */
function blockZones(brief: MapBriefView, zone: number): number[] {
  const zx = zone % brief.zonesWide;
  const zy = Math.floor(zone / brief.zonesWide);
  const zones: number[] = [];
  for (let y = zy - BLOCK_REACH_ZONES; y <= zy + BLOCK_REACH_ZONES; y++) {
    for (let x = zx - BLOCK_REACH_ZONES; x <= zx + BLOCK_REACH_ZONES; x++) {
      if (x >= 0 && y >= 0 && x < brief.zonesWide && y < brief.zonesHigh) zones.push(y * brief.zonesWide + x);
    }
  }
  return zones;
}

/** The free nodes of `colony`'s site block on its land, as the map brief took them. */
export function siteRoom(
  world: World,
  colony: { readonly land: number; readonly site: Readonly<HalfCellNode> },
): number {
  const brief = mapBriefOf(world);
  if (brief === null) return 0;
  let free = 0;
  for (const zone of blockZones(brief, zoneOfNode(brief, colony.site.hx, colony.site.hy)))
    if (brief.dominantLand[zone] === colony.land) free += brief.free[zone] ?? 0;
  return free;
}

/** Whether node `(hx, hy)` lies in the block around `zone`. */
export function siteBlockHolds(brief: MapBriefView, zone: number, hx: number, hy: number): boolean {
  const inside = zoneOfNode(brief, hx, hy);
  const row = (z: number): number => Math.floor(z / brief.zonesWide);
  return (
    Math.abs((inside % brief.zonesWide) - (zone % brief.zonesWide)) <= BLOCK_REACH_ZONES &&
    Math.abs(row(inside) - row(zone)) <= BLOCK_REACH_ZONES
  );
}

function zoneCentre(brief: MapBriefView, zone: number): HalfCellNode {
  const half = brief.zoneNodes / 2;
  return {
    hx: (zone % brief.zonesWide) * brief.zoneNodes + half,
    hy: Math.floor(zone / brief.zonesWide) * brief.zoneNodes + half,
  };
}

/** The lands sharing a water body with the seat's home, or null for a seat with no land start. */
function landsOverSea(brief: MapBriefView, home: number): ReadonlySet<number> | null {
  const waters = brief.landComponents.find((land) => land.component === home)?.waters;
  if (waters === undefined) return null;
  const lands = new Set<number>();
  for (const land of brief.landComponents) {
    if (land.component !== home && land.waters.some((water) => waters.includes(water)))
      lands.add(land.component);
  }
  return lands;
}

function scanCandidates(brief: MapBriefView, seat: number): readonly ColonySite[] {
  const start = brief.seats.find((s) => s.player === seat);
  const lands = start === undefined ? null : landsOverSea(brief, start.component);
  const wood = brief.goods.indexOf(WOOD_ID);
  const stone = brief.goods.indexOf(STONE_ID);
  if (start === undefined || lands === null || wood < 0 || stone < 0) return [];
  const home = { hx: start.hx, hy: start.hy };
  const rivals = brief.seats.filter((other) => other.player !== seat);
  const sites: ColonySite[] = [];
  for (let zone = 0; zone < brief.dominantLand.length; zone++) {
    const land = brief.dominantLand[zone] ?? NO_COMPONENT;
    if (!lands.has(land)) continue;
    let free = 0;
    let woodUnits = 0;
    let stoneUnits = 0;
    let fish = 0;
    for (const z of blockZones(brief, zone)) {
      if (brief.dominantLand[z] !== land) continue;
      free += brief.free[z] ?? 0;
      woodUnits += brief.deposits[z * brief.goods.length + wood] ?? 0;
      stoneUnits += brief.deposits[z * brief.goods.length + stone] ?? 0;
      fish += brief.fish[z] ?? 0;
    }
    if (free < MIN_FREE_NODES || woodUnits < MIN_WOOD || stoneUnits < MIN_STONE) continue;
    const centre = zoneCentre(brief, zone);
    const score =
      Math.min(woodUnits, WOOD_SCORE_CAP) +
      STONE_SCORE_WEIGHT * Math.min(stoneUnits, STONE_SCORE_CAP) +
      Math.floor(fish / FISH_SCORE_DIVISOR) -
      DISTANCE_SCORE_WEIGHT * hexDistance(home, centre);
    const contested = rivals.some((rival) => hexDistance(rival, centre) < hexDistance(home, centre));
    sites.push({ zone, land, centre, score, contested });
  }
  return sites.sort(
    (a, b) => Number(a.contested) - Number(b.contested) || b.score - a.score || a.zone - b.zone,
  );
}

/** The sites the static map offers `seat`, blocks on a land sharing water with home: those nearer it than
 *  any other seat's start first, so seats spread by what they all know, then best first, the lowest zone
 *  on a tie. Scanned once per seat, and a pure function of the saved brief. */
export function colonySiteCandidates(brief: MapBriefView, seat: number): readonly ColonySite[] {
  let bySeat = candidatesByBrief.get(brief);
  if (bySeat === undefined) {
    bySeat = new Map();
    candidatesByBrief.set(brief, bySeat);
  }
  let sites = bySeat.get(seat);
  if (sites === undefined) {
    sites = scanCandidates(brief, seat);
    bySeat.set(seat, sites);
  }
  return sites;
}

/** Every spot `seat` must keep a colony from: the other seats' starts and start buildings, which it may
 *  know, and the buildings it believes stand of every owner it does not call friend. */
function threatNodes(world: World, ctx: SystemContext, brief: MapBriefView, seat: number): HalfCellNode[] {
  const nodes: HalfCellNode[] = [];
  for (const start of brief.seats) {
    if (start.player === seat) continue;
    nodes.push({ hx: start.hx, hy: start.hy });
    for (const b of start.buildings) nodes.push({ hx: b.hx, hy: b.hy });
  }
  for (let owner = 0; owner < MAX_PLAYERS; owner++) {
    if (owner === seat || diplomacyStance(world, seat, owner) === 'friend') continue;
    const { seen, remembered } = believedBuildings(world, ctx, seat, owner);
    for (const e of seen) {
      const node = anchorNodeOf(world, e);
      if (node !== null) nodes.push(node);
    }
    for (const b of remembered) nodes.push({ hx: b.hx, hy: b.hy });
  }
  return nodes;
}

function clearOf(threats: readonly HalfCellNode[], at: HalfCellNode): boolean {
  return threats.every((node) => hexDistance(node, at) > COLONY_RANGE_NODES);
}

/** Whether `site` still lies out of {@link COLONY_RANGE_NODES} of all `seat` must keep clear of. Costs the
 *  believed buildings. */
export function colonySiteClear(world: World, ctx: SystemContext, seat: number, site: HalfCellNode): boolean {
  const brief = mapBriefOf(world);
  return brief !== null && clearOf(threatNodes(world, ctx, brief, seat), site);
}

/** Whether the block of `zone` still offers {@link MIN_STORE_SPOTS} on `land`. */
function storeFits(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  brief: MapBriefView,
  site: ColonySite,
  storeType: number,
  tribe: number,
): boolean {
  const probe = placementProbe(world, ctx.content, terrain, storeType, tribe);
  let spots = 0;
  for (const zone of blockZones(brief, site.zone)) {
    const left = (zone % brief.zonesWide) * brief.zoneNodes;
    const top = Math.floor(zone / brief.zonesWide) * brief.zoneNodes;
    for (let y = top; y < top + brief.zoneNodes; y++) {
      for (let x = left; x < left + brief.zoneNodes; x++) {
        if (!terrain.inBounds(x, y) || terrain.componentOf(terrain.nodeAt(x, y)) !== site.land) continue;
        if (probe.canPlace(x, y) && ++spots >= MIN_STORE_SPOTS) return true;
      }
    }
  }
  return false;
}

/**
 * The best site `seat` may settle now, skipping the `rejected` zones: of the {@link LIVE_CANDIDATES} best,
 * the first clear of every threat with room for a store. Null when none is. Costs the believed buildings
 * and, per clear candidate, up to a block of placement probes.
 */
export function surveyColonySite(
  world: World,
  ctx: SystemContext,
  seat: number,
  rejected: readonly number[],
): ColonySite | null {
  const terrain = ctx.terrain;
  const brief = mapBriefOf(world);
  const tribe = playerPlacementTribes(world, seat)?.[0];
  const store = buildingTypeByContentId(ctx.content, COLONY_STORE_BUILDING_ID);
  if (terrain === undefined || brief === null || tribe === undefined || store === undefined) return null;
  const sites = colonySiteCandidates(brief, seat)
    .filter((site) => !rejected.includes(site.zone))
    .slice(0, LIVE_CANDIDATES);
  if (sites.length === 0) return null;
  const threats = threatNodes(world, ctx, brief, seat);
  for (const site of sites) {
    if (clearOf(threats, site.centre) && storeFits(world, ctx, terrain, brief, site, store.typeId, tribe))
      return site;
  }
  return null;
}
