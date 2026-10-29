import { type MapBriefView, zoneOfNode } from '../../../components/index.js';
import type { Fixed } from '../../../core/fixed.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { NO_COMPONENT } from '../../../nav/terrain/index.js';
import { latticeOffsetDistance } from '../../../nav/terrain/lattice-distance.js';

/** The home band: zones whose centre lies within this many half-cell nodes (Manhattan) of the seat's
 *  anchor. Authored: about the build order's placement reach. On five decoded maps (diamentowa_dolina,
 *  magiczny_las, mroczny_las, krwawa_rzeka, specjalna_forteca) it holds 8 zones, 7-8k land nodes. */
export const HOME_BAND_NODES = 64;
/** The near band, holding the home band: a few minutes' walk. Authored; 29-33 zones on the same maps. */
export const NEAR_BAND_NODES = 128;

/** The goods a seat may hold or lack outright, whose distance shapes its strategy, plus fish. */
export const EXCLUSIVE_GOOD_IDS: readonly string[] = ['iron', 'gold', 'mushroom'];
export const FISH_ACCESS_KEY = 'fish';

/** How a seat reaches its nearest deposit: on its own land in the home or near band, further on its own
 *  land, only over water or across land it does not stand on, or not at all. Ordered best first. */
export const ACCESS_CLASSES = ['home', 'near', 'continent', 'overSea', 'none'] as const;
export type AccessClass = (typeof ACCESS_CLASSES)[number];

export interface GoodAccess {
  readonly access: AccessClass;
  /** Chebyshev zone distance from the seat's zone to the nearest zone of that class; null for `none`. */
  readonly zones: number | null;
}

/** Map headings with north up the screen. */
export type Direction8 = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** A zone set's summed layers. */
export interface ZoneSums {
  readonly zones: number;
  readonly land: number;
  readonly water: number;
  readonly free: number;
  readonly clearable: number;
  readonly blocked: number;
  readonly plantable: number;
  readonly fish: number;
  /** Per tracked good content id. */
  readonly deposits: ReadonlyMap<string, number>;
}

/** Another seat's start as this one sees it. Stances are read live elsewhere, never stored here. */
export interface SeatNeighbour {
  readonly player: number;
  readonly anchor: HalfCellNode;
  readonly direction: Direction8;
  /** The open-lattice walk distance between the anchors, in column units. */
  readonly distance: Fixed;
  readonly sameLand: boolean;
}

/** The map seen from one seat: a pure function of the map brief and the seat. */
export interface SeatBrief {
  readonly player: number;
  readonly anchor: HalfCellNode;
  readonly zone: number;
  readonly component: number;
  readonly home: ZoneSums;
  /** Holds the home band's zones too. */
  readonly near: ZoneSums;
  /** Every zone whose dominant land is the seat's land component. */
  readonly continent: ZoneSums;
  /** Per {@link EXCLUSIVE_GOOD_IDS} entry the brief tracks, and {@link FISH_ACCESS_KEY}. */
  readonly access: ReadonlyMap<string, GoodAccess>;
  /** Ascending player slot. */
  readonly others: readonly SeatNeighbour[];
}

/** The projection's pixel pitch of one half-cell step east and one south, for headings on screen. */
const HALF_COLUMN_PX = 34;
const HALF_ROW_PX = 19;
/** tan(22.5 degrees) as 12/29: a heading within this slope of an axis is that axis. */
const AXIS_SLOPE_NUM = 12;
const AXIS_SLOPE_DEN = 29;

type SeatStartView = MapBriefView['seats'][number];

const briefMemo = new WeakMap<MapBriefView, Map<number, SeatBrief | null>>();

/** The seat brief of `player`, or null when the map brief records no start for it. Memoized per brief
 *  object, which the scan writes once. */
export function seatBriefOf(brief: MapBriefView, player: number): SeatBrief | null {
  let bySeat = briefMemo.get(brief);
  if (bySeat === undefined) {
    bySeat = new Map();
    briefMemo.set(brief, bySeat);
  }
  const held = bySeat.get(player);
  if (held !== undefined) return held;
  const start = brief.seats.find((seat) => seat.player === player);
  const derived = start === undefined ? null : deriveSeatBrief(brief, start);
  bySeat.set(player, derived);
  return derived;
}

function deriveSeatBrief(brief: MapBriefView, start: SeatStartView): SeatBrief {
  const anchor = { hx: start.hx, hy: start.hy };
  const zone = zoneOfNode(brief, start.hx, start.hy);
  const home: number[] = [];
  const near: number[] = [];
  const continent: number[] = [];
  for (let z = 0; z < brief.zonesWide * brief.zonesHigh; z++) {
    const reach = zoneReach(brief, z, anchor);
    if (reach <= HOME_BAND_NODES) home.push(z);
    if (reach <= NEAR_BAND_NODES) near.push(z);
    if (onSeatLand(brief, z, start.component)) continent.push(z);
  }
  const access = new Map<string, GoodAccess>();
  brief.goods.forEach((good, column) => {
    if (!EXCLUSIVE_GOOD_IDS.includes(good)) return;
    access.set(
      good,
      accessOf(brief, start, zone, (z) => brief.deposits[z * brief.goods.length + column] ?? 0),
    );
  });
  access.set(
    FISH_ACCESS_KEY,
    accessOf(brief, start, zone, (z) => brief.fish[z] ?? 0),
  );
  const others: SeatNeighbour[] = [];
  for (const other of brief.seats) {
    if (other.player === start.player) continue;
    const dx = other.hx - start.hx;
    const dy = other.hy - start.hy;
    others.push({
      player: other.player,
      anchor: { hx: other.hx, hy: other.hy },
      direction: directionOf(dx, dy),
      distance: latticeOffsetDistance(dx, dy, start.hy),
      sameLand: start.component !== NO_COMPONENT && other.component === start.component,
    });
  }
  return {
    player: start.player,
    anchor,
    zone,
    component: start.component,
    home: sumZones(brief, home),
    near: sumZones(brief, near),
    continent: sumZones(brief, continent),
    access,
    others,
  };
}

/** Manhattan nodes from the zone's centre, cut to the map, to `anchor`. */
function zoneReach(brief: MapBriefView, zone: number, anchor: HalfCellNode): number {
  const zx = zone % brief.zonesWide;
  const zy = Math.floor(zone / brief.zonesWide);
  const minX = zx * brief.zoneNodes;
  const minY = zy * brief.zoneNodes;
  const cx = (minX + Math.min(brief.width, minX + brief.zoneNodes)) >> 1;
  const cy = (minY + Math.min(brief.height, minY + brief.zoneNodes)) >> 1;
  return Math.abs(cx - anchor.hx) + Math.abs(cy - anchor.hy);
}

function onSeatLand(brief: MapBriefView, zone: number, component: number): boolean {
  return component !== NO_COMPONENT && brief.dominantLand[zone] === component;
}

/** The best class over every zone holding some of the good, and the zone distance to the nearest zone
 *  of that class. */
function accessOf(
  brief: MapBriefView,
  start: SeatStartView,
  seatZone: number,
  amountIn: (zone: number) => number,
): GoodAccess {
  const anchor = { hx: start.hx, hy: start.hy };
  const sx = seatZone % brief.zonesWide;
  const sy = Math.floor(seatZone / brief.zonesWide);
  let best = ACCESS_CLASSES.indexOf('none');
  let bestZones: number | null = null;
  for (let z = 0; z < brief.zonesWide * brief.zonesHigh; z++) {
    if (amountIn(z) <= 0) continue;
    const zones = Math.max(
      Math.abs((z % brief.zonesWide) - sx),
      Math.abs(Math.floor(z / brief.zonesWide) - sy),
    );
    const rank = ACCESS_CLASSES.indexOf(classOf(brief, z, start.component, zoneReach(brief, z, anchor)));
    if (rank < best || (rank === best && bestZones !== null && zones < bestZones)) {
      best = rank;
      bestZones = zones;
    }
  }
  return { access: ACCESS_CLASSES[best] ?? 'none', zones: bestZones };
}

function classOf(brief: MapBriefView, zone: number, component: number, reach: number): AccessClass {
  if (!onSeatLand(brief, zone, component)) return 'overSea';
  if (reach <= HOME_BAND_NODES) return 'home';
  return reach <= NEAR_BAND_NODES ? 'near' : 'continent';
}

function sumZones(brief: MapBriefView, zones: readonly number[]): ZoneSums {
  let land = 0;
  let water = 0;
  let free = 0;
  let clearable = 0;
  let blocked = 0;
  let plantable = 0;
  let fish = 0;
  const deposits = new Map<string, number>(brief.goods.map((good) => [good, 0]));
  for (const z of zones) {
    land += brief.land[z] ?? 0;
    water += brief.water[z] ?? 0;
    free += brief.free[z] ?? 0;
    clearable += brief.clearable[z] ?? 0;
    blocked += brief.blocked[z] ?? 0;
    plantable += brief.plantable[z] ?? 0;
    fish += brief.fish[z] ?? 0;
    brief.goods.forEach((good, column) => {
      deposits.set(good, (deposits.get(good) ?? 0) + (brief.deposits[z * brief.goods.length + column] ?? 0));
    });
  }
  return { zones: zones.length, land, water, free, clearable, blocked, plantable, fish, deposits };
}

/** The screen heading from one anchor to another `dx` half-columns east and `dy` half-rows south. */
function directionOf(dx: number, dy: number): Direction8 {
  const x = dx * HALF_COLUMN_PX;
  const y = dy * HALF_ROW_PX;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ay * AXIS_SLOPE_DEN <= ax * AXIS_SLOPE_NUM) return x >= 0 ? 'e' : 'w';
  if (ax * AXIS_SLOPE_DEN <= ay * AXIS_SLOPE_NUM) return y >= 0 ? 's' : 'n';
  if (y < 0) return x >= 0 ? 'ne' : 'nw';
  return x >= 0 ? 'se' : 'sw';
}
