import { halfCellToScreenX, halfCellToScreenY } from '@open-northland/render/data';
import { hexDistanceBetween } from '@open-northland/sim';
import type { Tile } from '../../picking.js';

/** Where a ship's dock order moors: the sim's mooring rule for one ship, limited to the shore the viewer
 *  sees. `key` changes whenever an answer may. */
export interface MooringRule {
  readonly key: string;
  /** A shore point the ship's door may open on. */
  moors(col: number, row: number): boolean;
  /** A water node the ship may lie moored at, with a shore point at its door distance. */
  docks(col: number, row: number): boolean;
  /** The island a shore point lies on: points alike share one landmass. */
  landOf(col: number, row: number): number;
}

/** A ship a dock order could moor, as the berth planner reads it. */
export interface BerthShip {
  readonly vehicle: number;
  /** The node the ship stands on. */
  readonly at: Tile;
  /** The radius of the ship's footprint disc in nodes (`logicsize`). */
  readonly logicSize: number;
  /** How far from its node the ship's door opens (its passenger vector's distance). */
  readonly doorDistance: number;
  readonly rule: MooringRule;
}

/** A hull on the water: the node it stands on and its footprint disc's radius in nodes. */
export interface Hull {
  readonly at: Tile;
  readonly logicSize: number;
}

/** Where one ship of a dock order moors: `dock`, the water node its hull lies on, and the shore point
 *  (`col`, `row`) its door opens on. */
export interface Berth {
  readonly vehicle: number;
  readonly col: number;
  readonly row: number;
  readonly dock: Tile;
}

/** How far a dock click may land from the shore it moors at: the dock pick takes a loose aim, a plain
 *  right-click only one that touches the shore, so a click on open water near it still sails there. */
export const DOCK_PICK_SNAP_NODES = 8;
export const RIGHT_CLICK_SNAP_NODES = 3;

/** Free water left between two berthed footprint discs. A drawn hull reaches about a node past its disc
 *  on either side, so this leaves about one free cell between the drawn ships of a fleet told to dock at
 *  once. A project choice, tuned by eye; the original docks one ship per order. */
const BERTH_GAP_NODES = 4;
/** The farthest a fleet's berths spread from the clicked one, which bounds the shore scan. */
const MAX_FLEET_SPREAD_NODES = 48;

/**
 * Berths for `ships` along the shore around `cursor`: the shore point within `snap` nodes that lies
 * nearest the cursor on screen, then the points of its island nearest that one, each with a dock node
 * whose hull keeps a gap from every hull already berthed and from the `others` lying near, the hull lying
 * straight out from its point. Each berth goes to the nearest ship that can lie there; ships alike then
 * trade berths for the least total sail, which keeps their courses from crossing. Empty when no shore lies within `snap`; a ship left without a
 * berth is left out. Deterministic in its inputs, so the cursor's preview and the click's order agree.
 */
export function planBerths(
  ships: readonly BerthShip[],
  cursor: Tile,
  snap: number,
  others: readonly Hull[] = [],
): Berth[] {
  if (ships.length === 0) return [];
  const rules = distinctRules(ships);
  let anchor: Tile | null = null;
  let anchorDistance = Number.POSITIVE_INFINITY;
  for (const spot of shoreNear(rules, cursor, snap)) {
    const distance = screenDistanceSq(cursor, spot);
    if (distance < anchorDistance) {
      anchor = spot;
      anchorDistance = distance;
    }
  }
  if (anchor === null) return [];
  const from = anchor;
  const island = landOf(rules, from);
  const byDistance = shoreNear(rules, from, berthReach(ships))
    .filter((spot) => landOf(rules, spot) === island)
    .map((spot) => ({ spot, distance: screenDistanceSq(from, spot) }))
    .sort((a, b) => a.distance - b.distance || a.spot.row - b.spot.row || a.spot.col - b.spot.col);

  const free = new Set(ships);
  const berths: Berth[] = [];
  const hulls: Hull[] = [...others];
  for (const { spot } of byDistance) {
    if (free.size === 0) break;
    const ship = nearestShipFor(free, spot);
    if (ship === null) continue;
    const clear = (node: Tile): boolean =>
      hulls.every(
        (hull) =>
          hexDistanceBetween(hull.at.col, hull.at.row, node.col, node.row) >
          hull.logicSize + ship.logicSize + BERTH_GAP_NODES,
      );
    const dock = middleOf(dockRing(ship, spot).filter(clear));
    if (dock === null) continue;
    free.delete(ship);
    hulls.push({ at: dock, logicSize: ship.logicSize });
    berths.push({ vehicle: ship.vehicle, col: spot.col, row: spot.row, dock });
  }
  return shortestSails(ships, berths);
}

/** `berths` with the ships of each alike group (one rule, size and door distance, so any of them lies
 *  at any of their berths) matched to them for the least total sail on screen. A matching of least total
 *  straight-line length never crosses two courses: uncrossing them would shorten it. */
function shortestSails(ships: readonly BerthShip[], berths: readonly Berth[]): Berth[] {
  const byId = new Map(ships.map((ship) => [ship.vehicle, ship]));
  const groups = new Map<string, Berth[]>();
  for (const berth of berths) {
    const ship = byId.get(berth.vehicle);
    if (ship === undefined) continue;
    const kind = `${ship.rule.key}:${ship.logicSize}:${ship.doorDistance}`;
    groups.set(kind, [...(groups.get(kind) ?? []), berth]);
  }
  const out: Berth[] = [];
  for (const group of groups.values()) {
    const fleet = group.flatMap((berth) => byId.get(berth.vehicle) ?? []);
    const cost = fleet.map((ship) => group.map((berth) => Math.sqrt(screenDistanceSq(ship.at, berth.dock))));
    const pick = leastCostMatching(cost);
    fleet.forEach((ship, i) => {
      const berth = group[pick[i] ?? i];
      if (berth !== undefined) out.push({ ...berth, vehicle: ship.vehicle });
    });
  }
  return out;
}

/** The column each row of the square `cost` matrix takes for the least total cost (Hungarian method,
 *  O(n³)); n is a group's berths, bounded by the shore within the fleet's spread of the clicked one. */
function leastCostMatching(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const rowOf = new Array<number>(n + 1).fill(0); // the row matched to each column, 1-based; 0 is none
  const way = new Array<number>(n + 1).fill(0);
  for (let row = 1; row <= n; row++) {
    rowOf[0] = row;
    let col0 = 0;
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[col0] = true;
      const row0 = rowOf[col0] ?? 0;
      let delta = Number.POSITIVE_INFINITY;
      let col1 = 0;
      for (let col = 1; col <= n; col++) {
        if (used[col]) continue;
        const reduced = (cost[row0 - 1]?.[col - 1] ?? 0) - (u[row0] ?? 0) - (v[col] ?? 0);
        if (reduced < (minv[col] ?? 0)) {
          minv[col] = reduced;
          way[col] = col0;
        }
        if ((minv[col] ?? 0) < delta) {
          delta = minv[col] ?? 0;
          col1 = col;
        }
      }
      for (let col = 0; col <= n; col++) {
        if (used[col]) {
          const r = rowOf[col] ?? 0;
          u[r] = (u[r] ?? 0) + delta;
          v[col] = (v[col] ?? 0) - delta;
        } else minv[col] = (minv[col] ?? 0) - delta;
      }
      col0 = col1;
    } while ((rowOf[col0] ?? 0) !== 0);
    do {
      const col1 = way[col0] ?? 0;
      rowOf[col0] = rowOf[col1] ?? 0;
      col0 = col1;
    } while (col0 !== 0);
  }
  const pick = new Array<number>(n).fill(0);
  for (let col = 1; col <= n; col++) {
    const row = rowOf[col] ?? 0;
    if (row > 0) pick[row - 1] = col - 1;
  }
  return pick;
}

/** The node distance between two hulls of `logicSize` lying side by side with the berths' free water
 *  between their discs: a fleet's berths and its formation under way are spaced by it. */
export function hullSpacing(logicSize: number): number {
  return 2 * logicSize + 1 + BERTH_GAP_NODES;
}

/** How far from the clicked berth a fleet's berths may spread: a hull and a gap per further ship. */
export function berthReach(ships: readonly BerthShip[]): number {
  const widest = Math.max(0, ...ships.map((ship) => ship.logicSize));
  return Math.min(MAX_FLEET_SPREAD_NODES, (ships.length - 1) * hullSpacing(widest));
}

function distinctRules(ships: readonly BerthShip[]): MooringRule[] {
  const rules = new Map<string, MooringRule>();
  for (const ship of ships) if (!rules.has(ship.rule.key)) rules.set(ship.rule.key, ship.rule);
  return [...rules.values()];
}

/** The shore points any of `rules` moors at within `radius` nodes of `centre`, in scan order. */
function shoreNear(rules: readonly MooringRule[], centre: Tile, radius: number): Tile[] {
  const spots: Tile[] = [];
  for (let row = Math.max(0, centre.row - radius); row <= centre.row + radius; row++) {
    for (let col = Math.max(0, centre.col - radius); col <= centre.col + radius; col++) {
      if (hexDistanceBetween(centre.col, centre.row, col, row) > radius) continue;
      if (rules.some((rule) => rule.moors(col, row))) spots.push({ col, row });
    }
  }
  return spots;
}

/** The island of shore point `spot`, read off the first of `rules` that moors there. */
function landOf(rules: readonly MooringRule[], spot: Tile): number | undefined {
  return rules.find((rule) => rule.moors(spot.col, spot.row))?.landOf(spot.col, spot.row);
}

/** The free ship nearest `spot` whose rule moors there; ties to the lower id. */
function nearestShipFor(free: ReadonlySet<BerthShip>, spot: Tile): BerthShip | null {
  let best: BerthShip | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const ship of free) {
    if (!ship.rule.moors(spot.col, spot.row)) continue;
    const distance = hexDistanceBetween(ship.at.col, ship.at.row, spot.col, spot.row);
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && ship.vehicle < best.vehicle)
    ) {
      best = ship;
      bestDistance = distance;
    }
  }
  return best;
}

/** The dock nodes `ship` may lie at for `spot`: its water at exactly the door distance. */
function dockRing(ship: BerthShip, spot: Tile): Tile[] {
  const d = ship.doorDistance;
  const ring: Tile[] = [];
  for (let row = spot.row - d; row <= spot.row + d; row++) {
    for (let col = spot.col - d; col <= spot.col + d; col++) {
      if (hexDistanceBetween(spot.col, spot.row, col, row) === d && ship.rule.docks(col, row)) {
        ring.push({ col, row });
      }
    }
  }
  return ring;
}

/** The node of `nodes` nearest their centre on screen: the middle of a ring's arc over the water, where
 *  the hull lies straight out from the shore. Null for none. */
function middleOf(nodes: readonly Tile[]): Tile | null {
  if (nodes.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const node of nodes) {
    x += halfCellToScreenX(node.col, node.row);
    y += halfCellToScreenY(node.row);
  }
  const centre = { x: x / nodes.length, y: y / nodes.length };
  let best: Tile | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const dx = halfCellToScreenX(node.col, node.row) - centre.x;
    const dy = halfCellToScreenY(node.row) - centre.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

/** Squared world-px distance between two nodes as the screen draws them. */
function screenDistanceSq(a: Tile, b: Tile): number {
  const dx = halfCellToScreenX(a.col, a.row) - halfCellToScreenX(b.col, b.row);
  const dy = halfCellToScreenY(a.row) - halfCellToScreenY(b.row);
  return dx * dx + dy * dy;
}
