import { atPeace, endPeace, Owner, peaceHoldsUntilTick, peacePartnerBits } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { SimEvent } from '../../core/events.js';
import { TICKS_PER_MINUTE } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, type NodeArea } from '../../nav/halfcell.js';
import type { System } from '../context.js';
import { forEachBuildingNear } from '../spatial/buildings.js';

/** The match minutes before the end of a peace at which a `peaceEnding` notice fires. Project choice. */
export const PEACE_NOTICE_MINUTES = [5, 1] as const;

/**
 * How near a peace partner's building a seat may neither send its people and vehicles nor build while the
 * peace holds, in map points (`hexDistance`) from the building's anchor: about thirty cells. A project choice
 * with no source, so nobody camps or builds at a partner's door to strike the tick the peace ends.
 */
export const PEACE_KEEP_OUT_RADIUS_NODES = 60;

/**
 * Ends the lobby peace at the head of its deadline tick, ahead of the commands, so no order or pass
 * of that tick still reads it, and announces the end in advance. One singleton read per tick.
 */
export const peaceSystem: System = (world, ctx) => {
  const until = peaceHoldsUntilTick(world);
  if (until === null) return;
  if (ctx.tick >= until) {
    endPeace(world);
    ctx.events.emit({ kind: 'peaceEnded' });
    return;
  }
  const left = until - ctx.tick;
  for (const minutesLeft of PEACE_NOTICE_MINUTES) {
    if (left === minutesLeft * TICKS_PER_MINUTE) ctx.events.emit({ kind: 'peaceEnding', minutesLeft });
  }
};

/** Whether a peace binds the owners of `a` and `b`; false when either has none. */
export function ownersAtPeace(world: World, a: Entity, b: Entity): boolean {
  const first = world.tryGet(a, Owner);
  const second = world.tryGet(b, Owner);
  return first !== undefined && second !== undefined && atPeace(world, first.player, second.player);
}

/**
 * The ground a peace keeps `player` off: every node within {@link PEACE_KEEP_OUT_RADIUS_NODES} of a
 * building of a seat the peace binds it to, foundations included, and nearer that building than every
 * building of its own seat. Own ground always wins, so a partner's foundation dropped inside a town never
 * shuts its owner out. No route is blocked: only orders and placements read it.
 */
export interface PeaceGround {
  readonly bars: (x: number, y: number) => boolean;
}

/** {@link PeaceGround} over one node area, with a memo key naming the buildings that decide it. */
export interface PeaceGroundWithin extends PeaceGround {
  readonly key: string;
}

/** A building that decides the zone: its anchor node and whether it is the asking seat's own. */
interface ZoneAnchor {
  readonly hx: number;
  readonly hy: number;
  readonly own: boolean;
}

/** Which side of the peace `building` stands on for `player`: its own, a partner's, or neither. */
function sideOf(world: World, building: Entity, player: number, partners: number): 'own' | 'partner' | null {
  const seat = world.tryGet(building, Owner)?.player;
  if (seat === undefined) return null;
  if (seat === player) return 'own';
  return (partners & (1 << seat)) !== 0 ? 'partner' : null;
}

/** Whether the nearest partner building is within the radius and nearer than every own building. */
function barredBy(nearestOwn: number, nearestPartner: number): boolean {
  return nearestPartner <= PEACE_KEEP_OUT_RADIUS_NODES && nearestPartner < nearestOwn;
}

/** Fills `into` with the own and partner buildings anchored in the box `reach` nodes around `(hx, hy)`. */
function collectZoneAnchors(
  world: World,
  player: number,
  partners: number,
  hx: number,
  hy: number,
  reach: number,
  into: ZoneAnchor[],
): void {
  forEachBuildingNear(world, hx, hy, reach, (building, bx, by) => {
    const side = sideOf(world, building, player, partners);
    if (side !== null) into.push({ hx: bx, hy: by, own: side === 'own' });
  });
}

function barredAmong(anchors: readonly ZoneAnchor[], x: number, y: number): boolean {
  let nearestPartner = Infinity;
  let nearestOwn = Infinity;
  for (const anchor of anchors) {
    const distance = hexDistanceBetween(anchor.hx, anchor.hy, x, y);
    if (anchor.own) nearestOwn = Math.min(nearestOwn, distance);
    else nearestPartner = Math.min(nearestPartner, distance);
  }
  return barredBy(nearestOwn, nearestPartner);
}

/**
 * The peace's {@link PeaceGround} for `player`, null while no peace binds the seat, so a seat outside the
 * peace, a map AI camp included, and every seat after it ends pay nothing. Cost per node: the buildings
 * anchored in the region-index regions that the radius box around it overlaps, never a seat's roster.
 */
export function peaceGroundFor(world: World, player: number | undefined): PeaceGround | null {
  if (player === undefined) return null;
  const partners = peacePartnerBits(world, player);
  if (partners === 0) return null;
  // One visitor per ground folds the nearest distances in place, so a probe allocates nothing per building.
  let x = 0;
  let y = 0;
  let nearestOwn = Infinity;
  let nearestPartner = Infinity;
  const visit = (building: Entity, bx: number, by: number): void => {
    const side = sideOf(world, building, player, partners);
    if (side === null) return;
    const distance = hexDistanceBetween(bx, by, x, y);
    if (side === 'own') nearestOwn = Math.min(nearestOwn, distance);
    else nearestPartner = Math.min(nearestPartner, distance);
  };
  return {
    bars: (atX, atY) => {
      x = atX;
      y = atY;
      nearestOwn = Infinity;
      nearestPartner = Infinity;
      // A building outside the box lies past the radius, so it can neither bar the node nor beat a
      // partner's building that does.
      forEachBuildingNear(world, x, y, PEACE_KEEP_OUT_RADIUS_NODES, visit);
      return barredBy(nearestOwn, nearestPartner);
    },
  };
}

/** {@link peaceGroundFor} over `area` only: the deciding buildings are read once for the whole area, and
 *  `bars` answers only for its nodes. */
export function peaceGroundWithin(
  world: World,
  player: number | undefined,
  area: NodeArea,
): PeaceGroundWithin | null {
  if (player === undefined) return null;
  const partners = peacePartnerBits(world, player);
  if (partners === 0) return null;
  const hx = Math.floor((area.minHx + area.maxHx) / 2);
  const hy = Math.floor((area.minHy + area.maxHy) / 2);
  const halfSpan = Math.max(area.maxHx - hx, hx - area.minHx, area.maxHy - hy, hy - area.minHy);
  const anchors: ZoneAnchor[] = [];
  collectZoneAnchors(world, player, partners, hx, hy, halfSpan + PEACE_KEEP_OUT_RADIUS_NODES, anchors);
  return {
    bars: (x, y) => barredAmong(anchors, x, y),
    key: anchors.map((anchor) => `${anchor.hx},${anchor.hy},${anchor.own ? 1 : 0}`).join(';'),
  };
}

/** What a refused order would have done at its node. */
type PeaceRefusedOrder = PeaceRefusal['what'];

export type PeaceRefusal = Omit<Extract<SimEvent, { kind: 'peaceRefused' }>, 'kind'>;

/** A player order's acting entity or seat, its node and what it does there; null for an order the peace
 *  never reads. Map setup (`force`) and a placement without an owner are no player's orders. */
function orderedAt(world: World, command: Command): PeaceRefusal | null {
  const seatOf = (e: Entity): number | undefined => world.tryGet(e, Owner)?.player;
  let player: number | undefined;
  let what: PeaceRefusedOrder = 'walk';
  switch (command.kind) {
    case 'moveUnit':
    case 'attackMoveUnit':
      player = seatOf(command.entity);
      break;
    case 'moveVehicle':
    case 'dockVehicle':
      player = seatOf(command.vehicle);
      break;
    case 'placeSignpost':
      player = seatOf(command.entity);
      what = 'build';
      break;
    case 'placeBuilding':
    case 'placePalisade':
      if (command.force === true) return null;
      player = command.owner;
      what = 'build';
      break;
    default:
      return null;
  }
  return player === undefined ? null : { player, x: command.x, y: command.y, what };
}

/**
 * The seat whose order the peace refuses, where it was sent and what it would have done there, or null
 * when the order goes: a walk or drive of any of its people or vehicles, or a placement of its own, onto
 * the seat's {@link PeaceGround}. Paths and work the settlers choose themselves are never read.
 */
export function peaceRefusal(world: World, command: Command): PeaceRefusal | null {
  const order = orderedAt(world, command);
  if (order === null) return null;
  return peaceGroundFor(world, order.player)?.bars(order.x, order.y) === true ? order : null;
}
