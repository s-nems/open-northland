import {
  aiControlEntity,
  Building,
  GroundPlan,
  SeatRoom,
  type SeatRoomState,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import {
  COMPUTER_DECISION_INTERVAL_TICKS,
  computerDecisionSlot,
  decisionIndex,
  moduleBeatDue,
} from '../../ai-shared/cadence.js';
import { buildingTypeByContentId, countedTiers } from '../../ai-shared/content-lookup.js';
import type { EnemyFire } from '../../ai-shared/military/defence/index.js';
import { firstRingNode } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { ANCHOR_ONLY, buildingFootprintOf, translatedCells } from '../../footprint/geometry.js';
import { overflowBuildReachNodes, STALLED_PLACEMENT_RETRY_DECISIONS } from './entries.js';
import { baseComponent, buildReach } from './placement.js';
import { seatSpotAcceptor } from './plots.js';
import { seatTuning } from './seat-order.js';

/** The stable content id of the home chain's base tier, whose zone is the unit room is measured in. */
export const ROOM_HOME_BUILDING = 'home_level_00';

/** Home zones of room a seat keeps for each home it raises (authored): the ground beside a home stays for
 *  what else grows there. */
export const FIT_PER_HOME = 2;

/** The most homes room lifts a seat's housing lane to (owner ruling: about fourteen top-tier homes on a rich
 *  seat, and a bigger settlement makes a stronger player on every plan). */
export const ROOM_HOMES_CAP = 14;

/**
 * How many free zones a review counts at most, `homes` standing against a housing cap of `cap`: what its
 * readers can tell apart and no more, so a settlement with room stops its walk early. The filled tower ring
 * asks whether a home still fits ({@link FIT_PER_HOME}), and the homes lift, once homes reach a cap below
 * {@link ROOM_HOMES_CAP}, how many more homes fit up to it.
 */
function zonesCounted(homes: number, cap: number): number {
  const lift = homes >= cap && cap < ROOM_HOMES_CAP ? FIT_PER_HOME * ROOM_HOMES_CAP - homes : 0;
  return Math.max(FIT_PER_HOME, lift);
}

/** Decisions between a seat's room reviews, a stalled placement's retry pace (about a game minute): felled
 *  trees and mined-out deposits free ground slowly. */
export const ROOM_REVIEW_EVERY_DECISIONS = STALLED_PLACEMENT_RETRY_DECISIONS;

/**
 * The seat's first decision after `tick` on its room beat ({@link moduleBeatDue}). A review costs a few
 * milliseconds, so it never shares a tick with another seat's: every seat decides on a tick of its own in
 * the decision interval ({@link computerDecisionSlot}), and the beat, offset by the seat, gives each seat a
 * different interval of the {@link ROOM_REVIEW_EVERY_DECISIONS}, so the seats' reviews spread over the
 * minute rather than bunching in one interval.
 */
export function nextRoomReviewTick(tick: number, player: number): number {
  let start = (decisionIndex(tick) + 1) * COMPUTER_DECISION_INTERVAL_TICKS;
  while (!moduleBeatDue(start, player, ROOM_REVIEW_EVERY_DECISIONS))
    start += COMPUTER_DECISION_INTERVAL_TICKS;
  return start + computerDecisionSlot(player);
}

/** Where {@link freeHomeZones} counts: the nodes within `radius` Manhattan nodes of the base anchor, and
 *  of those only the ones `contains` takes when given. */
export interface RoomArea {
  readonly radius: number;
  readonly contains?: (x: number, y: number) => boolean;
}

/** The area a home placement may search at its widest (`./placement.ts`): the overflow reach of every
 *  building the seat owns, walked out to twice that from the base. */
export function placementArea(
  world: World,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
): RoomArea {
  const overflow = overflowBuildReachNodes(seatTuning(world, player).reachNodes);
  const radius = 2 * overflow;
  // Laid out once over the walk's box, so each node's test is one read.
  return { radius, contains: buildReach(world, owned, anchor, overflow).boxTest(anchor, radius) };
}

/**
 * How many home zones fit side by side on the seat's base land, off its plots, within `area`: one ring walk
 * out from `anchor`, each accepted spot taking its zone, up to `max`.
 */
export function freeHomeZones(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  anchor: HalfCellNode,
  tribe: number,
  underFire: EnemyFire,
  max: number,
  area: RoomArea,
): number {
  if (max <= 0) return 0;
  const home = buildingTypeByContentId(ctx.content, ROOM_HOME_BUILDING);
  if (home === undefined) return 0;
  const zone = buildingFootprintOf(ctx.content, home.typeId, tribe)?.reserved ?? ANCHOR_ONLY;
  const fan = area.radius;
  const within = area.contains;
  const accept = seatSpotAcceptor(world, ctx, terrain, player, home.typeId, tribe).around(
    underFire,
    anchor,
    fan,
  );
  const land = baseComponent(world, ctx, terrain, player);
  const taken = new Set<NodeId>();
  let fits = 0;
  // The walk never stops on a node: each fit is recorded and the walk goes on, so one pass counts them all.
  firstRingNode(anchor.hx, anchor.hy, fan, (x, y) => {
    if (fits >= max) return true;
    if (!terrain.inBounds(x, y) || terrain.componentOf(terrain.nodeAt(x, y)) !== land) return false;
    if ((within !== undefined && !within(x, y)) || !accept(x, y)) return false;
    const cells = translatedCells(terrain, zone, x, y);
    if (cells.some((node) => taken.has(node))) return false;
    for (const node of cells) taken.add(node);
    fits++;
    return false;
  });
  return fits;
}

/**
 * Measures the seat's room ({@link freeHomeZones}), as far as its readers need with its housing lane's
 * `homesCap`, and counts its homes of `owned`, sites included, once its review is due ({@link nextRoomReviewTick}); on a seat keeping a ground plan only once its plots are
 * drawn, so the opening's ground counts as room only where no plot keeps it. Observed on
 * arabskie_wyspy_wolna_gra_mieszana: measured from the start, a seat cut to two homes raised four on the
 * ground its brewery and barracks were later plotted on.
 */
export function keepSeatRoom(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  owned: readonly Entity[],
  anchor: HalfCellNode,
  tribe: number,
  homesCap: number,
  underFire: () => EnemyFire,
): void {
  const carrier = aiControlEntity(world, player);
  if (carrier === null) return;
  if (world.tryGet(carrier, GroundPlan)?.drawn === false) return;
  const held = world.tryGet(carrier, SeatRoom);
  if (held !== undefined && ctx.tick < held.reviewTick) return;
  const home = buildingTypeByContentId(ctx.content, ROOM_HOME_BUILDING);
  const chain = home === undefined ? new Set<number>() : countedTiers(ctx.content, home, undefined);
  const homes = owned.filter((e) => chain.has(world.get(e, Building).buildingType)).length;
  const freeZones = freeHomeZones(
    world,
    ctx,
    terrain,
    player,
    anchor,
    tribe,
    underFire(),
    zonesCounted(homes, homesCap),
    placementArea(world, player, owned, anchor),
  );
  const reviewTick = nextRoomReviewTick(ctx.tick, player);
  if (held === undefined) world.add(carrier, SeatRoom, { freeZones, homes, reviewTick });
  else {
    const room = world.mut(carrier, SeatRoom);
    room.freeZones = freeZones;
    room.homes = homes;
    room.reviewTick = reviewTick;
  }
}

function seatRoomOf(world: World, player: number): Readonly<SeatRoomState> | null {
  const carrier = aiControlEntity(world, player);
  return carrier === null ? null : (world.tryGet(carrier, SeatRoom) ?? null);
}

/**
 * The most homes the housing lane raises: `cap`, lifted once the homes counted at the last review reach it
 * to the homes the room then held, those standing and the free zones together, {@link FIT_PER_HOME} zones a
 * home, as the ground plan sizes its homes; never past {@link ROOM_HOMES_CAP} by room alone. Both counts
 * come from one review, so the cap holds still until the next.
 */
export function roomHomesCap(world: World, player: number, cap: number): number {
  const room = seatRoomOf(world, player);
  if (room === null || room.homes < cap) return cap;
  return Math.max(cap, Math.min(ROOM_HOMES_CAP, Math.floor((room.homes + room.freeZones) / FIT_PER_HOME)));
}

/** Whether the seat's land is built up: measured, and too little room left for another home, so the homes
 *  lift has nothing more to raise. */
export function roomFilled(world: World, player: number): boolean {
  const room = seatRoomOf(world, player);
  return room !== null && room.freeZones < FIT_PER_HOME;
}
