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
/** The units of a good in a block that count it as there for a colony's gatherers. */
const VARIETY_UNITS: Readonly<Record<string, number>> = { wood: 300, stone: 150, mud: 50, iron: 50 };
/** A zone this free joins the open ground around the block's centre. */
const OPEN_ZONE_FREE_NODES = 64;
/** Water nodes that make a zone coast, and how far a coast zone may lie from the centre zone to count. */
const COAST_WATER_NODES = 32;

/** Each part of a site's score runs to {@link PART_POINTS}: room, variety, grass and shore weigh most, and
 *  distance least. Owner ruling: fairly open with room to expand, varied resources close by, a patch of grass
 *  for a farm, near the shore; the nearest no longer wins. */
const PART_POINTS = 100;
const ROOM_WEIGHT = 4;
const VARIETY_WEIGHT = 4;
const GRASS_WEIGHT = 3;
const SHORE_WEIGHT = 2;
const FISH_WEIGHT = 1;
const DISTANCE_WEIGHT = 1;
/** Past these a site gains nothing: the ground for a colony's plan, a farm's fields and well, a swarm's
 *  catch, and the widest sea a line crosses in a few minutes. */
const ROOM_FULL_NODES = 2000;
const GRASS_FULL_NODES = 400;
const FISH_FULL_UNITS = 400;
const DISTANCE_FULL_NODES = 400;
/** The best sites the live test weighs, in score order. */
const LIVE_CANDIDATES = 8;

/** Owner ruling: a colony keeps clear of every seat it does not call friend. The figure is authored from the
 *  survey: hex nodes between a site's centre and the nearest start or believed building. */
export const COLONY_RANGE_NODES = 96;

/** The warehouse a colony founds on. */
export const COLONY_STORE_BUILDING_ID = 'stock_00';
/** The fewest spots for it the block must offer as the map stands now. */
const MIN_STORE_SPOTS = 300;

/** What a site's block holds, the score's reads. */
export interface SiteTally {
  /** Free nodes joined to the centre zone over open zones. */
  readonly room: number;
  /** Of {@link VARIETY_UNITS}' goods, how many the block holds enough of. */
  readonly goods: number;
  readonly grass: number;
  readonly fish: number;
  /** Whether a coast zone lies in the block. */
  readonly coast: boolean;
  /** Hex nodes from the seat's start. */
  readonly distance: number;
}

/** {@link part} of `full` a figure makes. */
function part(figure: number, full: number): number {
  return Math.floor((PART_POINTS * Math.min(figure, full)) / full);
}

/** A block's score (owner ruling): open ground to grow on, varied resources in gatherers' reach, grass for a
 *  farm and a well, a shore and its fish. Distance only breaks what is left. */
export function siteScore(tally: SiteTally): number {
  const goods = Object.keys(VARIETY_UNITS).length;
  return (
    ROOM_WEIGHT * part(tally.room, ROOM_FULL_NODES) +
    VARIETY_WEIGHT * part(tally.goods, goods) +
    GRASS_WEIGHT * part(tally.grass, GRASS_FULL_NODES) +
    (tally.coast ? SHORE_WEIGHT * PART_POINTS : 0) +
    FISH_WEIGHT * part(tally.fish, FISH_FULL_UNITS) -
    DISTANCE_WEIGHT * part(tally.distance, DISTANCE_FULL_NODES)
  );
}

/** A 3x3 zone block on one land the seat's ships can reach. */
export interface ColonySite {
  /** The block's centre zone, its identity. */
  readonly zone: number;
  readonly land: number;
  /** The centre zone's middle node. */
  readonly centre: HalfCellNode;
  readonly score: number;
  /** Another seat's start lies nearer: it weighs the same block, so this seat looks there late. */
  readonly contested: boolean;
  /** An earlier seat's first pick lies in range of it: this seat looks there last. */
  readonly crowded: boolean;
}

const candidatesByBrief = new WeakMap<MapBriefView, ReadonlyMap<number, readonly ColonySite[]>>();

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

/** The free nodes of the zones of `block` on `land` joined to `zone` over open zones. */
function openRoom(brief: MapBriefView, block: readonly number[], land: number, zone: number): number {
  const open = (z: number): boolean =>
    block.includes(z) && brief.dominantLand[z] === land && (brief.free[z] ?? 0) >= OPEN_ZONE_FREE_NODES;
  if (!open(zone)) return 0;
  const seen = new Set([zone]);
  const queue = [zone];
  let room = 0;
  for (let z = queue.shift(); z !== undefined; z = queue.shift()) {
    room += brief.free[z] ?? 0;
    const left = z % brief.zonesWide > 0 ? [z - 1] : [];
    const right = z % brief.zonesWide < brief.zonesWide - 1 ? [z + 1] : [];
    for (const next of [...left, ...right, z - brief.zonesWide, z + brief.zonesWide]) {
      if (seen.has(next) || !open(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return room;
}

/** What the block round `zone` holds on `land`. */
function tallyBlock(
  brief: MapBriefView,
  zone: number,
  land: number,
  distance: number,
): SiteTally & { readonly free: number; readonly wood: number; readonly stone: number } {
  const block = blockZones(brief, zone);
  const units = new Map<string, number>();
  let free = 0;
  let grass = 0;
  let fish = 0;
  let coast = false;
  for (const z of block) {
    if (brief.dominantLand[z] !== land) continue;
    free += brief.free[z] ?? 0;
    grass += brief.plantable[z] ?? 0;
    fish += brief.fish[z] ?? 0;
    coast ||= (brief.water[z] ?? 0) >= COAST_WATER_NODES;
    for (const [column, id] of brief.goods.entries())
      units.set(id, (units.get(id) ?? 0) + (brief.deposits[z * brief.goods.length + column] ?? 0));
  }
  const held = (id: string): number => units.get(id) ?? 0;
  return {
    room: openRoom(brief, block, land, zone),
    goods: Object.entries(VARIETY_UNITS).filter(([id, least]) => held(id) >= least).length,
    grass,
    fish,
    coast,
    distance,
    free,
    wood: held('wood'),
    stone: held('stone'),
  };
}

function scanCandidates(brief: MapBriefView, seat: number): readonly ColonySite[] {
  const start = brief.seats.find((s) => s.player === seat);
  const lands = start === undefined ? null : landsOverSea(brief, start.component);
  if (start === undefined || lands === null) return [];
  const home = { hx: start.hx, hy: start.hy };
  const rivals = brief.seats.filter((other) => other.player !== seat);
  const sites: ColonySite[] = [];
  for (let zone = 0; zone < brief.dominantLand.length; zone++) {
    const land = brief.dominantLand[zone] ?? NO_COMPONENT;
    if (!lands.has(land)) continue;
    const centre = zoneCentre(brief, zone);
    const tally = tallyBlock(brief, zone, land, hexDistance(home, centre));
    if (tally.free < MIN_FREE_NODES || tally.wood < MIN_WOOD || tally.stone < MIN_STONE) continue;
    const contested = rivals.some((rival) => hexDistance(rival, centre) < hexDistance(home, centre));
    sites.push({ zone, land, centre, score: siteScore(tally), contested, crowded: false });
  }
  return sites;
}

const ranked = (a: ColonySite, b: ColonySite): number =>
  Number(a.crowded) - Number(b.crowded) ||
  Number(a.contested) - Number(b.contested) ||
  b.score - a.score ||
  a.zone - b.zone;

/** Each seat's sites: what {@link scanCandidates} finds, seats ascending, a site within
 *  {@link COLONY_RANGE_NODES} of an earlier seat's first pick last of all, or two seats sail for one coast
 *  and the later turns back at the range rule. */
function spreadSeats(brief: MapBriefView): Map<number, readonly ColonySite[]> {
  const bySeat = new Map<number, readonly ColonySite[]>();
  const picks: HalfCellNode[] = [];
  for (const { player } of [...brief.seats].sort((a, b) => a.player - b.player)) {
    const sites = scanCandidates(brief, player)
      .map((site) => ({
        ...site,
        crowded: picks.some((at) => hexDistance(at, site.centre) <= COLONY_RANGE_NODES),
      }))
      .sort(ranked);
    bySeat.set(player, sites);
    const first = sites[0];
    if (first !== undefined) picks.push(first.centre);
  }
  return bySeat;
}

/** The sites the static map offers `seat`, blocks on a land sharing water with home: those nearer it than
 *  any other seat's start and clear of the earlier seats' picks first, so seats spread by what they all know,
 *  then best first, the lowest zone on a tie. Scanned once per brief, and a pure function of it. */
export function colonySiteCandidates(brief: MapBriefView, seat: number): readonly ColonySite[] {
  let bySeat = candidatesByBrief.get(brief);
  if (bySeat === undefined) {
    bySeat = spreadSeats(brief);
    candidatesByBrief.set(brief, bySeat);
  }
  return bySeat.get(seat) ?? [];
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
