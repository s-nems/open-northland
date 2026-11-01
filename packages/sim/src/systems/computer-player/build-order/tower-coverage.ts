import type { BuildingType } from '@open-northland/data';
import { Building } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { nodeBoxOfCircles, withinNodeRadius } from '../../../nav/node-circle.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { spotAcceptor } from '../../ai-shared/building-spot.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { anchorNodeOf, firstRingNode } from '../../ai-shared/node-geometry.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { seatBaseOf } from '../base.js';
import type { BuildOrderEntry, DefenceWants } from './entries.js';
import { grassBound } from './grass-reserve.js';
import { buildReach } from './placement.js';
import { seatDefenceFirst, seatTuning } from './seat-order.js';
import { baseWalkTest } from './spot-walk.js';
import { OPENING_DEFENCE, seatDefenceWants, towerRingStands } from './tower-defence.js';

/** Which buildings a coverage entry spreads: a tower ring by the defence it wants
 *  (`./tower-defence.ts`), a store ring every owned building within `radius` world-metric nodes of the
 *  base or a warehouse. */
export type Coverage = TowerCoverage | StoreCoverage;
export interface TowerCoverage {
  readonly by: 'tower';
  readonly wants: DefenceWants;
  /** The content id of the ring's tower, whose circle spaces the front's slots. */
  readonly building: string;
}
export interface StoreCoverage {
  readonly by: 'store';
  readonly radius: number;
}

/** A tower entry's wants as the seat holds them ({@link seatDefenceWants}). */
export function coverageOf(
  world: World,
  ctx: SystemContext,
  player: number,
  entry: Extract<BuildOrderEntry, { kind: 'towerCoverage' | 'storeCoverage' }>,
): Coverage {
  if (entry.kind === 'storeCoverage') return { by: 'store', radius: entry.radius };
  const wants = seatDefenceWants(world, ctx, player, entry.defence ?? OPENING_DEFENCE);
  return { by: 'tower', wants, building: entry.building };
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

/** The nodes a store ring spreads from: the seat's base and its stores in any construction state, so
 *  coverage arrives with the site rather than with the finished building. */
function storeCentres(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): HalfCellNode[] {
  const index = contentIndex(ctx.content);
  const base = seatBaseOf(world, ctx, player);
  const centres: HalfCellNode[] = [];
  for (const e of owned) {
    if (e !== base && index.buildings.get(world.get(e, Building).buildingType)?.kind !== 'storage') continue;
    const node = anchorNodeOf(world, e);
    if (node !== null) centres.push(node);
  }
  return centres;
}

/**
 * The first node a store ring must reach that is not yet covered and that `found` takes, or null: each
 * target is offered in turn, so a status read stops at the first. A store covers what fills it: the
 * seat's workplaces, so a far production cluster has somewhere to unload, and then its gatherers' work
 * flags (canonical settler order), where the mined and quarried goods pile up; homes and towers pass,
 * since a tower rings the settlement's edge and would pull warehouses out to it.
 */
export function firstUncovered<T>(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: StoreCoverage,
  found: (target: HalfCellNode) => T | null,
): T | null {
  const index = contentIndex(ctx.content);
  const centres = storeCentres(world, ctx, player, owned);
  const offer = (e: Entity): T | null => {
    const node = anchorNodeOf(world, e);
    if (node === null) return null;
    if (centres.some((c) => withinNodeRadius(c.hx, c.hy, node.hx, node.hy, coverage.radius))) return null;
    return found(node);
  };
  for (const e of owned) {
    if (index.buildings.get(world.get(e, Building).buildingType)?.kind !== 'workplace') continue;
    const hit = offer(e);
    if (hit !== null) return hit;
  }
  for (const e of ownedSettlers(world, player)) {
    const flag = liveWorkFlag(world, e);
    if (flag === undefined) continue;
    const hit = offer(flag.flag);
    if (hit !== null) return hit;
  }
  return null;
}

/** Whether the seat stands covered: a tower ring short of no defence it wants ({@link towerRingStands}), a
 *  store ring with no node left outside ({@link firstUncovered}). */
export function seatCovered(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: Coverage,
): boolean {
  if (coverage.by === 'store') return firstUncovered(world, ctx, player, owned, coverage, uncovered) === null;
  return towerRingStands(world, ctx, player, owned, coverage);
}

const uncovered = (): true => true;

/**
 * The search for the next warehouse, built once a store ring: a spot near the target that covers it,
 * outside every standing store's own circle, since two stores side by side serve the same ground. The
 * accept combines two metrics: world-metric coverage of the target and the seat's Manhattan build reach.
 * It needs the full ring budget because the world metric is anisotropic (34 px E/W against 19 px N/S), so
 * a covering node can sit almost twice the coverage radius in rows from the target. A target no
 * building's reach comes near enough to cover, a flag far out on the map, is turned down before the walk.
 * With `reserveGrass` it looks off the grass first, and it takes only a spot a fair walk from the base
 * door, as `placementSpot` does.
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
  coverage: StoreCoverage,
  underFire: EnemyFire,
  reserveGrass: boolean,
): (target: HalfCellNode) => HalfCellNode | null {
  const apartFrom = storeCentres(world, ctx, player, owned);
  const { reachNodes } = seatTuning(world, player);
  const fan = 2 * reachNodes;
  const acceptor = spotAcceptor(world, ctx, terrain, player, type.typeId, tribe);
  const settlement = buildReach(world, owned, anchor, reachNodes);
  const box = nodeBoxOfCircles([{ x: 0, y: 0, r: coverage.radius }]);
  // Every node covering a target lies within this Manhattan span of it.
  const coverageSpan = box.maxX + box.maxY;
  const spareGrass = reserveGrass && !grassBound(type);
  const walkable = baseWalkTest(world, ctx, terrain, player);
  return (target) => {
    if (!settlement.meets(target, coverageSpan)) return null;
    const reach = settlement.around(target, fan);
    const search = (offGrass: boolean) => {
      const accept = acceptor.around(underFire, target, fan, offGrass);
      return firstRingNode(target.hx, target.hy, fan, (x, y) => {
        // Coverage first: one distance test, and it passes only nodes near the target, itself in the reach.
        if (!withinNodeRadius(x, y, target.hx, target.hy, coverage.radius)) return false;
        if (apartFrom.some((c) => withinNodeRadius(c.hx, c.hy, x, y, coverage.radius))) return false;
        if (!reach.contains(x, y)) return false;
        return accept(x, y) && (walkable === null || walkable(x, y));
      });
    };
    return (spareGrass ? search(true) : null) ?? search(false);
  };
}
