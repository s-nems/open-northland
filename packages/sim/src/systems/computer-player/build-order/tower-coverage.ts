import type { BuildingType } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { hexDistance } from '../../../nav/halfcell.js';
import { nodeBoxOfCircles, withinNodeRadius } from '../../../nav/node-circle.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { spotAcceptor } from '../../ai-shared/building-spot.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import {
  anchorCentroid,
  anchorNodeOf,
  firstRingNode,
  outwardNode,
  towardNode,
} from '../../ai-shared/node-geometry.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { seatBaseOf } from '../base.js';
import { forecastAttackOrigin } from '../military/deadline.js';
import { militaryOrdersOf } from '../strategy/military.js';
import type { BuildOrderEntry } from './entries.js';
import {
  DEFENCE_FRONT_ROWS,
  EVEN_FRONT_ROWS,
  scheduledTowers,
  seatFrontLine,
  TOWER_CONTENT_IDS,
} from './front.js';
import { grassBound } from './grass-reserve.js';
import { buildReach } from './placement.js';
import { DEFENCE_TOWER_RADIUS_PCT, seatDefenceFirst, seatTuning } from './seat-order.js';
import { baseWalkTest } from './spot-walk.js';

// The coverage circle is a planning heuristic only; what a tower does under an alarm is
// `systems/defence/`.

/** Planning radius of a tower's or the base's assumed defence circle, in world-metric nodes.
 *  Deliberately under the house bow's own 0-29 reach (`readviews/defence.ts`), tuned by watching a
 *  settlement grow (authored): towers ringed at full bow range stand too far out to read as part of it. */
export const TOWER_DEFENCE_RADIUS_NODES = 19;

export { TOWER_CONTENT_IDS };

/** How far past the covering target the search seed is pushed out from the settlement centroid, in
 *  nodes. Approximation: far enough to bias the pick outward, short enough to land just beyond the
 *  last building. */
const TOWER_OUTSKIRTS_PUSH_NODES = 6;

/** Which buildings a coverage entry spreads, and how far each one reaches, in world-metric nodes. */
export interface Coverage {
  readonly by: 'tower' | 'store';
  readonly radius: number;
  /** Whether the base counts as a centre of its own. */
  readonly baseCovers: boolean;
}

/** A tower entry's radius is scaled by the seat's military orders (`towerRadiusPct`, percent), so a
 *  defensive plan rings its towers denser and an aggressive one sparser, and again by
 *  {@link DEFENCE_TOWER_RADIUS_PCT} while the seat's defence comes first; then the base's own bows no longer
 *  count as a tower, so a compact settlement still raises towers before a forecast attack. */
export function coverageOf(
  world: World,
  ctx: SystemContext,
  player: number,
  entry: Extract<BuildOrderEntry, { kind: 'towerCoverage' | 'storeCoverage' }>,
): Coverage {
  if (entry.kind === 'storeCoverage') return { by: 'store', radius: entry.radius, baseCovers: true };
  const planned = Math.floor(
    ((entry.radius ?? TOWER_DEFENCE_RADIUS_NODES) * militaryOrdersOf(world, player).towerRadiusPct) / 100,
  );
  if (!seatDefenceFirst(world, ctx, player)) return { by: 'tower', radius: planned, baseCovers: true };
  return { by: 'tower', radius: Math.floor((planned * DEFENCE_TOWER_RADIUS_PCT) / 100), baseCovers: false };
}

/** How many tower sites a ring lane keeps open at once (owner ruling: the ring stands by the military
 *  deadline, so it never waits on one far site), and how many while the seat's defence comes first, when
 *  the ring is the defence against a forecast attack (authored). A store lane keeps one. */
const TOWER_RING_SITES = 2;
const DEFENCE_TOWER_RING_SITES = 3;

/** How many tower sites a ring lane of `player`'s keeps open at once. */
export function towerRingSites(world: World, ctx: SystemContext, player: number): number {
  return seatDefenceFirst(world, ctx, player) ? DEFENCE_TOWER_RING_SITES : TOWER_RING_SITES;
}

/** How many sites of its own a coverage lane of `entry` keeps open at once for `player`. */
export function coverageLaneSites(
  world: World,
  ctx: SystemContext,
  player: number,
  entry: Extract<BuildOrderEntry, { kind: 'towerCoverage' | 'storeCoverage' }>,
): number {
  return entry.kind === 'storeCoverage' ? 1 : towerRingSites(world, ctx, player);
}

/** The nodes a coverage entry spreads its buildings from: the seat's base (unless `baseCovers` is off) plus
 *  its towers (or its stores) in any construction state, so coverage arrives with the site rather than
 *  with the finished building. */
function coverageCentres(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: Coverage,
): HalfCellNode[] {
  const index = contentIndex(ctx.content);
  const base = seatBaseOf(world, ctx, player);
  const centres: HalfCellNode[] = [];
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    const centre =
      coverage.by === 'tower'
        ? type !== undefined && TOWER_CONTENT_IDS.includes(type.id)
        : type?.kind === 'storage';
    if (!centre && !(e === base && coverage.baseCovers)) continue;
    const node = anchorNodeOf(world, e);
    if (node !== null) centres.push(node);
  }
  return centres;
}

/** How near one of its slots a tower stands to hold it, in percent of the line's spacing (authored): half,
 *  so neighbouring slots never share a tower and each slot takes its own. */
const FRONT_SLOT_RADIUS_PCT = 50;

/**
 * The first node the coverage must reach that is not yet covered and that `found` takes, or null: each
 * target is offered in turn, so a status read stops at the first. `found` gets the radius its spot must
 * lie within, or null for a target the coverage circle must reach.
 *
 * A tower ring first holds its seat's front ({@link seatFrontLine}, owner ruling: the towers stand as a
 * line on the side the attacks come from, the town behind it): each line slot without a tower within
 * {@link FRONT_SLOT_RADIUS_PCT} of the spacing, spaced one coverage radius apart, {@link DEFENCE_FRONT_ROWS}
 * rows while the seat's defence comes first and {@link EVEN_FRONT_ROWS} otherwise. Then it covers the owned
 * buildings {@link towerTargets} offers, each facing an attack inside {@link FACING_RING_DEPTH} circles. A
 * seat with forecast attacks raises no more towers, sites included, than {@link scheduledTowers} wants by
 * now (owner ruling: the towers finish a bit before each wave).
 *
 * A store covers what fills it: the seat's workplaces, so a far production cluster has somewhere to
 * unload, and then its gatherers' work flags (canonical settler order), where the mined and quarried goods
 * pile up; homes and towers pass, since a tower rings the settlement's edge and would pull warehouses out
 * to it.
 */
export function firstUncovered<T>(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: Coverage,
  found: (target: HalfCellNode, within: number | null) => T | null,
): T | null {
  const index = contentIndex(ctx.content);
  const centres = coverageCentres(world, ctx, player, owned, coverage);
  if (coverage.by === 'tower') {
    const towers = coverage.baseCovers
      ? coverageCentres(world, ctx, player, owned, { ...coverage, baseCovers: false })
      : centres;
    const wanted = scheduledTowers(world, ctx, player);
    if (wanted !== null && towers.length >= wanted) return null;
    const hit = frontSlotTarget(world, ctx, player, owned, towers, coverage, found);
    if (hit !== null) return hit;
  }
  const facing = coverage.by === 'tower' ? towerTargets(world, ctx, player, owned, coverage) : null;
  const depth = facing === null ? 1 : FACING_RING_DEPTH;
  const offer = (e: Entity): T | null => {
    const node = anchorNodeOf(world, e);
    if (node === null) return null;
    let circles = 0;
    for (const c of centres) {
      if (withinNodeRadius(c.hx, c.hy, node.hx, node.hy, coverage.radius) && ++circles >= depth) return null;
    }
    return found(node, null);
  };
  for (const e of facing ?? owned) {
    if (
      coverage.by === 'store' &&
      index.buildings.get(world.get(e, Building).buildingType)?.kind !== 'workplace'
    )
      continue;
    const hit = offer(e);
    if (hit !== null) return hit;
  }
  if (coverage.by === 'tower') return null;
  for (const e of ownedSettlers(world, player)) {
    const flag = liveWorkFlag(world, e);
    if (flag === undefined) continue;
    const hit = offer(flag.flag);
    if (hit !== null) return hit;
  }
  return null;
}

/** The first front slot no tower holds that `found` takes, or null ({@link firstUncovered}). */
function frontSlotTarget<T>(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  towers: readonly HalfCellNode[],
  coverage: Coverage,
  found: (target: HalfCellNode, within: number | null) => T | null,
): T | null {
  const line = seatFrontLine(world, ctx, player, owned);
  const base = seatBaseOf(world, ctx, player);
  const anchor = base === null ? null : anchorNodeOf(world, base);
  if (line === null || anchor === null) return null;
  const within = Math.max(1, Math.floor((coverage.radius * FRONT_SLOT_RADIUS_PCT) / 100));
  const rows = coverage.baseCovers ? EVEN_FRONT_ROWS : DEFENCE_FRONT_ROWS;
  const settlement = buildReach(world, owned, anchor, seatTuning(world, player).reachNodes);
  const box = nodeBoxOfCircles([{ x: 0, y: 0, r: within }]);
  for (const slot of line.slots(coverage.radius, rows)) {
    // A slot off the map or out of every building's reach is no work the ring could do.
    if (ctx.terrain?.inBounds(slot.hx, slot.hy) !== true) continue;
    if (!settlement.meets(slot, box.maxX + box.maxY)) continue;
    if (towers.some((t) => withinNodeRadius(t.hx, t.hy, slot.hx, slot.hy, within))) continue;
    const hit = found(slot, within);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The point a tower ring faces while the seat's defence comes first (`baseCovers` off): where its
 * forecast scripted attacks set out from ({@link forecastAttackOrigin}), else null for an even ring. Owner
 * ruling: on a map whose scripted waves come from one side, the towers stand on that side.
 */
function towerFront(
  world: World,
  ctx: SystemContext,
  player: number,
  coverage: Coverage,
): HalfCellNode | null {
  if (coverage.by !== 'tower' || coverage.baseCovers) return null;
  return forecastAttackOrigin(world, ctx, player);
}

/** How many tower circles a building facing a forecast attack stands in (owner ruling: the defence of a
 *  seat whose defence comes first rings densely on the attack side). On mroczny_las a single circle each
 *  left a cramped seat two or three towers against a wave of 30-50 raiders. */
const FACING_RING_DEPTH = 2;

/** The buildings a tower ring facing a {@link towerFront} covers, in the order it is offered them: only
 *  those no farther from it than the seat's base, the nearest the base first (ascending id on a tie), so
 *  the towers stand between the attack and the heart of the settlement before its outskirts; null for an
 *  even ring, which covers every owned building by ascending id. */
function towerTargets(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: Coverage,
): readonly Entity[] | null {
  const front = towerFront(world, ctx, player, coverage);
  const base = seatBaseOf(world, ctx, player);
  const baseNode = base === null ? null : anchorNodeOf(world, base);
  if (front === null || baseNode === null) return null;
  const reach = hexDistance(baseNode, front);
  const facing: { e: Entity; fromBase: number }[] = [];
  for (const e of owned) {
    const node = anchorNodeOf(world, e);
    if (node === null || hexDistance(node, front) > reach) continue;
    facing.push({ e, fromBase: hexDistance(node, baseNode) });
  }
  facing.sort((a, b) => a.fromBase - b.fromBase || a.e - b.e);
  return facing.map((f) => f.e);
}

/** Whether the seat stands covered: no node is left outside the coverage ({@link firstUncovered}). */
export function seatCovered(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: Coverage,
): boolean {
  return firstUncovered(world, ctx, player, owned, coverage, uncovered) === null;
}

const uncovered = (): true => true;

/**
 * The search for the next covering building, built once a coverage entry: a tower is seeded just past the
 * target, out from the settlement or, facing a {@link towerFront}, toward it; a front slot's tower and a
 * warehouse on the target itself, the slot's spot within the radius `firstUncovered` hands with it. Two
 * towers side by side double the defence, but two stores side by side serve the same ground, so a
 * warehouse's spot also lies outside every standing store's own circle. The accept combines two metrics:
 * world-metric coverage of the target and the seat's Manhattan build reach. It needs the full ring budget because the world metric is
 * anisotropic (34 px E/W against 19 px N/S), so a covering node can sit almost twice the coverage radius
 * in rows from the target. A target no building's reach comes near enough to cover, a flag far out on the
 * map, is turned down before the walk. With `reserveGrass` it looks off the grass first, and it takes only
 * a spot a fair walk from the base door, as `placementSpot` does.
 */
export function coverageSpotSearch(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  type: BuildingType,
  tribe: number,
  coverage: Coverage,
  underFire: EnemyFire,
  reserveGrass: boolean,
): (target: HalfCellNode, within: number | null) => HalfCellNode | null {
  const centroid = anchorCentroid(world, owned);
  const front = towerFront(world, ctx, player, coverage);
  const apartFrom = coverage.by === 'tower' ? [] : coverageCentres(world, ctx, player, owned, coverage);
  const { reachNodes } = seatTuning(world, player);
  const fan = 2 * reachNodes;
  const acceptor = spotAcceptor(world, ctx, terrain, player, type.typeId, tribe);
  const settlement = buildReach(world, owned, anchor, reachNodes);
  const box = nodeBoxOfCircles([{ x: 0, y: 0, r: coverage.radius }]);
  // Every node covering a target lies within this Manhattan span of it.
  const coverageSpan = box.maxX + box.maxY;
  const spareGrass = reserveGrass && !grassBound(type);
  const walkable = baseWalkTest(world, ctx, terrain, player);
  return (target, within) => {
    if (!settlement.meets(target, coverageSpan)) return null;
    const radius = within ?? coverage.radius;
    const seed =
      coverage.by !== 'tower' || within !== null
        ? target
        : front !== null
          ? towardNode(target, front, TOWER_OUTSKIRTS_PUSH_NODES)
          : outwardNode(centroid ?? target, target, TOWER_OUTSKIRTS_PUSH_NODES);
    const reach = settlement.around(seed, fan);
    const search = (offGrass: boolean) => {
      const accept = acceptor.around(underFire, seed, fan, offGrass);
      return firstRingNode(seed.hx, seed.hy, fan, (x, y) => {
        // Coverage first: one distance test, and it passes only nodes near the target, itself in the reach.
        if (!withinNodeRadius(x, y, target.hx, target.hy, radius)) return false;
        if (apartFrom.some((c) => withinNodeRadius(c.hx, c.hy, x, y, coverage.radius))) return false;
        if (!reach.contains(x, y)) return false;
        return accept(x, y) && (walkable === null || walkable(x, y));
      });
    };
    return (spareGrass ? search(true) : null) ?? search(false);
  };
}
