import type { BuildingType } from '@open-northland/data';
import { Building, playerPlacementTribes, UnderConstruction, Upgrading } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import { hexDistance, hexDistanceBetween } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { buildingTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { anchorNodeOf, firstRingNode } from '../../ai-shared/node-geometry.js';
import { shelterFireRadius } from '../../conflict/shelter-fire.js';
import type { SystemContext } from '../../context.js';
import { shelterCapacityOf } from '../../readviews/index.js';
import { seatBaseOf } from '../base.js';
import { MID_GAME_FROM_TICKS } from '../game-phase.js';
import { forecastAttackOrigin } from '../military/deadline.js';
import { militaryOrdersOf } from '../strategy/military.js';
import type { DefenceWants } from './entries.js';
import { scheduledTowers, seatFrontLine, TOWER_CONTENT_IDS } from './front.js';
import { grassBound } from './grass-reserve.js';
import { type BuildReach, buildReach } from './placement.js';
import { seatSpotAcceptor } from './plots.js';
import { seatDefenceFirst, seatTuning } from './seat-order.js';
import { baseWalkTest } from './spot-walk.js';

// A tower ring scores the seat's defence from the circles the player sees in defence mode: every
// headquarters, barracks and tower, standing or a site, adds its garrison over the ground its house bow
// covers. What a building does under an alarm is `systems/defence/`.

/** The ground one building defends and how strongly: its defence-mode reach in map points
 *  (`shelterFireRadius`) and the garrison it shelters (`shelterCapacity`), the value it adds over that
 *  ground. */
export interface DefenceCircle {
  readonly hx: number;
  readonly hy: number;
  readonly radius: number;
  readonly value: number;
}

/** The opening ring's wants (owner ruling: the whole village under a minimum defence, the front under a
 *  stronger one). Garrisons in content: headquarters 30, upper tower 20, lower tower and barracks 10. So
 *  every building stands in some defence circle, and a front slot under an upper and a lower tower's, two
 *  upper towers' or the headquarters' own. */
export const OPENING_DEFENCE: DefenceWants = { village: 10, front: 30 };

/** How much more defence a ring wants while the seat's defence comes first, in percent (authored): on
 *  mroczny_las a cramped seat's whole settlement sits inside its headquarters' circle, so at the opening
 *  wants it raised no tower before the first scripted wave. */
export const DEFENCE_FIRST_WANT_PCT = 170;

/** From when a lower tower under its wants is upgraded ahead of a new tower (owner ruling: later in the
 *  game the upgrade goes first): the mid game, when a new tower already rises at the upper tier
 *  (`./direct-tier.ts`). */
export const TOWER_UPGRADE_FIRST_FROM_TICKS = MID_GAME_FROM_TICKS;

/** The defence circle `house` throws from `node`, or null for a type with no defence mode. */
export function defenceCircleOf(
  ctx: SystemContext,
  house: { readonly buildingType: number; readonly tribe: number; readonly record?: string | undefined },
  node: HalfCellNode,
): DefenceCircle | null {
  const value = shelterCapacityOf(ctx.content, house.buildingType);
  if (value === 0) return null;
  const radius = shelterFireRadius(ctx.content, house, node.hx, node.hy);
  return radius === undefined ? null : { hx: node.hx, hy: node.hy, radius, value };
}

/** The defence circles of `owned` in any construction state, so a site defends in the plan from the
 *  decision that opens it. */
export function seatDefenceCircles(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
): DefenceCircle[] {
  const circles: DefenceCircle[] = [];
  for (const e of owned) {
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const circle = defenceCircleOf(ctx, world.get(e, Building), node);
    if (circle !== null) circles.push(circle);
  }
  return circles;
}

/** The defence the `circles` sum to over node `(hx, hy)`. */
export function defenceAt(circles: readonly DefenceCircle[], hx: number, hy: number): number {
  let sum = 0;
  for (const c of circles) if (hexDistanceBetween(c.hx, c.hy, hx, hy) <= c.radius) sum += c.value;
  return sum;
}

/** `wants` as `player`'s seat holds them: divided by its military orders' `towerWantDivisorPct` and
 *  raised by {@link DEFENCE_FIRST_WANT_PCT} while its defence comes first, rounded up. */
export function seatDefenceWants(
  world: World,
  ctx: SystemContext,
  player: number,
  wants: DefenceWants,
): DefenceWants {
  const divisor = militaryOrdersOf(world, player).towerWantDivisorPct;
  const first = seatDefenceFirst(world, ctx, player) ? DEFENCE_FIRST_WANT_PCT : 100;
  const scale = (want: number): number => Math.ceil((want * first) / divisor);
  return { village: scale(wants.village), front: scale(wants.front) };
}

/** A node a tower ring defends: what it wants there and what it has. */
export interface DefenceTarget {
  readonly node: HalfCellNode;
  readonly want: number;
  readonly has: number;
  readonly front: boolean;
}

/** One tower ring decision's view of the seat's defence. */
export interface TowerPlan {
  readonly circles: readonly DefenceCircle[];
  /** Every node of the front's band, at its want or not. */
  readonly front: readonly HalfCellNode[];
  /** The targets under their want, the lowest covered share first ({@link towerPlan}). */
  readonly short: readonly DefenceTarget[];
  readonly reach: BuildReach;
}

/** How far a hex circle's nodes reach in Manhattan steps, in percent of its radius: a circle of radius
 *  `r` spans `r` rows and, `r` rows out, half as many columns more. */
const HEX_MANHATTAN_SPAN_PCT = 150;

/**
 * The seat's defence against `wants` ({@link seatDefenceWants}): the front's band wants `front`, every
 * other building `village`. The band holds the slots of the seat's front line ({@link seatFrontLine})
 * spaced one tower circle apart and within its build reach, the buildings beyond that line, and while the
 * seat's defence comes first every building facing its forecast attacks ({@link facingBuildings}). A
 * building with a defence circle of its own is no target. A target at its want gets no tower, so towers
 * never clump. The short targets come lowest covered share first, then the front, then in offer order:
 * the slots straight ahead first, the buildings by ascending id or, facing an attack, nearest the base.
 * A seat with forecast attacks raises no more towers, sites included, than {@link scheduledTowers} wants
 * by now (owner ruling: the towers finish a bit before each wave): it is then short of nothing.
 */
export function towerPlan(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: TowerWants,
): TowerPlan | null {
  const scan = towerScan(world, ctx, player, owned, coverage);
  if (scan === null) return null;
  const front: HalfCellNode[] = [];
  const scored: { target: DefenceTarget; order: number }[] = [];
  for (const target of scan.targets) {
    if (target.front) front.push(target.node);
    if (target.has < target.want) scored.push({ target, order: scored.length });
  }
  scored.sort(
    (a, b) =>
      a.target.has * b.target.want - b.target.has * a.target.want ||
      Number(b.target.front) - Number(a.target.front) ||
      a.order - b.order,
  );
  return { circles: scan.circles, front, short: scored.map((s) => s.target), reach: scan.reach };
}

/** Whether {@link towerPlan} would find no short target, stopping at the first one. */
export function towerRingStands(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: TowerWants,
): boolean {
  const scan = towerScan(world, ctx, player, owned, coverage);
  if (scan === null) return true;
  for (const target of scan.targets) if (target.has < target.want) return false;
  return true;
}

type TowerWants = { readonly wants: DefenceWants; readonly building: string };

/** {@link towerPlan}'s inputs, its targets offered lazily in offer order, at their want or not. */
function towerScan(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: TowerWants,
): { circles: readonly DefenceCircle[]; reach: BuildReach; targets: Iterable<DefenceTarget> } | null {
  const base = seatBaseOf(world, ctx, player);
  const anchor = base === null ? null : anchorNodeOf(world, base);
  if (anchor === null) return null;
  const circles = seatDefenceCircles(world, ctx, owned);
  const reach = buildReach(world, owned, anchor, seatTuning(world, player).reachNodes);
  const wanted = scheduledTowers(world, ctx, player);
  const capped = wanted !== null && countTowers(world, ctx, owned) >= wanted;
  const targets = capped ? [] : defenceTargets(world, ctx, player, owned, coverage, anchor, circles, reach);
  return { circles, reach, targets };
}

function* defenceTargets(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  coverage: TowerWants,
  anchor: HalfCellNode,
  circles: readonly DefenceCircle[],
  reach: BuildReach,
): Generator<DefenceTarget> {
  const { wants } = coverage;
  const target = (node: HalfCellNode, front: boolean): DefenceTarget => ({
    node,
    want: front ? wants.front : wants.village,
    has: defenceAt(circles, node.hx, node.hy),
    front,
  });
  const line = seatFrontLine(world, ctx, player, owned);
  const tower = buildingTypeByContentId(ctx.content, coverage.building);
  const tribe = playerPlacementTribes(world, player)?.[0];
  const spacing =
    tower === undefined || tribe === undefined
      ? 0
      : (defenceCircleOf(ctx, { buildingType: tower.typeId, tribe }, anchor)?.radius ?? 0);
  const span = Math.ceil((spacing * HEX_MANHATTAN_SPAN_PCT) / 100);
  if (line !== null && spacing > 0) {
    for (const slot of line.slots(spacing, 1)) {
      // A slot off the map or out of every building's reach is no work the ring could do.
      if (ctx.terrain?.inBounds(slot.hx, slot.hy) !== true || !reach.meets(slot, span)) continue;
      yield target(slot, true);
    }
  }
  const facing = new Set(facingBuildings(world, ctx, player, owned, anchor));
  for (const e of facing.size === 0 ? owned : [...facing, ...owned.filter((o) => !facing.has(o))]) {
    const node = anchorNodeOf(world, e);
    if (node === null || defenceCircleOf(ctx, world.get(e, Building), node) !== null) continue;
    yield target(node, facing.has(e) || (line?.beyond(node.hx, node.hy) ?? false));
  }
}

function countTowers(world: World, ctx: SystemContext, owned: readonly Entity[]): number {
  const index = contentIndex(ctx.content);
  let n = 0;
  for (const e of owned) {
    const type = index.buildings.get(world.get(e, Building).buildingType);
    if (type !== undefined && TOWER_CONTENT_IDS.includes(type.id)) n++;
  }
  return n;
}

/**
 * While the seat's defence comes first, the buildings facing where its forecast scripted attacks set out
 * ({@link forecastAttackOrigin}, owner ruling: on a map whose waves come from one side, the towers stand
 * on that side): those no farther from it than the base, nearest the base first (ascending id on a tie),
 * so the towers stand between the attack and the heart of the settlement. None for an even ring.
 */
function facingBuildings(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  baseNode: HalfCellNode,
): Entity[] {
  if (!seatDefenceFirst(world, ctx, player)) return [];
  const origin = forecastAttackOrigin(world, ctx, player);
  if (origin === null) return [];
  const reach = hexDistance(baseNode, origin);
  const facing: { e: Entity; fromBase: number }[] = [];
  for (const e of owned) {
    const node = anchorNodeOf(world, e);
    if (node === null || hexDistance(node, origin) > reach) continue;
    facing.push({ e, fromBase: hexDistance(node, baseNode) });
  }
  facing.sort((a, b) => a.fromBase - b.fromBase || a.e - b.e);
  return facing.map((f) => f.e);
}

/** What a circle of `value` over `(hx, hy)` within `radius` adds toward the plan's short targets: each
 *  target takes up to what it still lacks. */
export function defenceGain(plan: TowerPlan, hx: number, hy: number, radius: number, value: number): number {
  let gain = 0;
  for (const t of plan.short) {
    if (hexDistanceBetween(hx, hy, t.node.hx, t.node.hy) <= radius) gain += Math.min(value, t.want - t.has);
  }
  return gain;
}

/** How far from a short target, in percent of the tower's radius, the ring's candidate centres stand
 *  (authored): halfway out, so a centre still covers its target with room to reach its neighbours. */
const CANDIDATE_OFFSET_PCT = 50;

/** How near another defence building a new tower may stand at least, in percent of its radius (authored):
 *  half, so two towers holding a front overlap over most of it without standing side by side. On
 *  krwawa_rzeka a front slot wanting a second tower got it 6 map points from the first. */
export const TOWER_APART_PCT = 50;

/** How far around a candidate centre a tower spot is looked for, in percent of the tower's radius
 *  (authored): a quarter, so neighbouring centres' searches barely overlap. */
const CANDIDATE_SPREAD_PCT = 25;

/**
 * The spot of the next tower of `type`, or null when no short target has one: for each short target in
 * plan order, the candidate centres around it (the target and six points halfway to its circle's edge)
 * by the defence they add ({@link defenceGain}), the farthest from the base first on a tie, so the ring
 * stands at the settlement's edge; the first legal node near a centre that still covers the target and
 * stands {@link TOWER_APART_PCT} of a radius from every defence building wins.
 * With `reserveGrass` it looks off the grass around every centre of a target first, and it takes only a
 * spot a fair walk from the base door, as `placementSpot` does.
 */
export function towerSpot(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  plan: TowerPlan,
  type: BuildingType,
  tribe: number,
  underFire: EnemyFire,
  reserveGrass: boolean,
): HalfCellNode | null {
  const base = seatBaseOf(world, ctx, player);
  const baseNode = base === null ? null : anchorNodeOf(world, base);
  if (baseNode === null) return null;
  const acceptor = seatSpotAcceptor(world, ctx, terrain, player, type.typeId, tribe);
  const walkable = baseWalkTest(world, ctx, terrain, player);
  const spareGrass = reserveGrass && !grassBound(type);
  for (const target of plan.short) {
    const circle = defenceCircleOf(ctx, { buildingType: type.typeId, tribe }, target.node);
    if (circle === null) return null;
    const { radius, value } = circle;
    const offset = Math.floor((radius * CANDIDATE_OFFSET_PCT) / 100);
    const spread = Math.max(1, Math.floor((radius * CANDIDATE_SPREAD_PCT) / 100));
    const apart = Math.floor((radius * TOWER_APART_PCT) / 100);
    const { hx, hy } = target.node;
    const half = Math.floor(offset / 2);
    const centres = [
      { hx, hy },
      { hx: hx + offset, hy },
      { hx: hx - offset, hy },
      { hx: hx + half, hy: hy - offset },
      { hx: hx - half, hy: hy - offset },
      { hx: hx + half, hy: hy + offset },
      { hx: hx - half, hy: hy + offset },
    ]
      .filter((c) => terrain.inBounds(c.hx, c.hy))
      .map((c, i) => ({
        c,
        i,
        gain: defenceGain(plan, c.hx, c.hy, radius, value),
        out: hexDistance(c, baseNode),
      }))
      .sort((a, b) => b.gain - a.gain || b.out - a.out || a.i - b.i);
    // A tower guards the land it stands on: one across the water covers nothing of the target's.
    const land = terrain.componentOf(terrain.nodeAtClamped(hx, hy));
    const search = (c: HalfCellNode, offGrass: boolean): HalfCellNode | null => {
      const reach = plan.reach.around(c, spread);
      const accept = acceptor.around(underFire, c, spread, offGrass);
      return firstRingNode(c.hx, c.hy, spread, (x, y) => {
        if (hexDistanceBetween(x, y, hx, hy) > radius) return false;
        if (!terrain.inBounds(x, y) || terrain.componentOf(terrain.nodeAt(x, y)) !== land) return false;
        if (plan.circles.some((d) => hexDistanceBetween(d.hx, d.hy, x, y) < apart)) return false;
        if (!reach.contains(x, y)) return false;
        return accept(x, y) && (walkable === null || walkable(x, y));
      });
    };
    for (const offGrass of spareGrass ? [true, false] : [false]) {
      for (const { c } of centres) {
        const spot = search(c, offGrass);
        if (spot !== null) return spot;
      }
    }
  }
  return null;
}

/**
 * The standing lower tower a short ring upgrades ahead of a new tower (owner ruling: later in the game the
 * upgrade goes first), or null: from {@link TOWER_UPGRADE_FIRST_FROM_TICKS}, a finished tower whose
 * upgrade lifts a short target, the one adding most first, else one whose circle reaches the front's band;
 * ascending id on a tie. `upper` is the tier it rises to.
 */
export function towerToUpgrade(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  plan: TowerPlan,
  upper: BuildingType,
): Entity | null {
  if (ctx.tick < TOWER_UPGRADE_FIRST_FROM_TICKS || plan.short.length === 0) return null;
  const index = contentIndex(ctx.content);
  let best: Entity | null = null;
  let bestGain = 0;
  for (const e of owned) {
    const building = world.get(e, Building);
    if (building.built < ONE || world.has(e, UnderConstruction) || world.has(e, Upgrading)) continue;
    const type = index.buildings.get(building.buildingType);
    if (type?.upgradeTarget !== upper.typeId || !TOWER_CONTENT_IDS.includes(type.id)) continue;
    const node = anchorNodeOf(world, e);
    if (node === null) continue;
    const now = defenceCircleOf(ctx, building, node);
    const next = defenceCircleOf(ctx, { ...building, buildingType: upper.typeId }, node);
    if (now === null || next === null || next.value <= now.value) continue;
    const lifts = defenceGain(plan, node.hx, node.hy, next.radius, next.value - now.value);
    // A front tower whose band already holds its want still goes up before a new tower elsewhere, ranked
    // under every upgrade that lifts a short target.
    const atFront = plan.front.some((f) => hexDistanceBetween(node.hx, node.hy, f.hx, f.hy) <= now.radius);
    const gain = lifts > 0 ? lifts + 1 : atFront ? 1 : 0;
    if (gain > bestGain) {
      best = e;
      bestGain = gain;
    }
  }
  return best;
}
