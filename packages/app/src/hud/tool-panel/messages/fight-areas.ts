import {
  type HalfCellNode,
  hexDistanceBetween,
  nodeOfPosition,
  positionedWithin,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  isBuilding,
  isPalisade,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
} from '../../../game/snapshot.js';
import type { MessageFeedState } from './feed.js';
import { type FightTally, USER_MESSAGE_TYPE, type UserMessage, type UserMessageType } from './types.js';

/** Where a fight is: inside the seat's settlement, or out where its people work and march. */
export type FightPlace = 'settlement' | 'field';

/**
 * A hit counts as inside the settlement when the struck body is one of the seat's buildings or walls, or
 * one of them (a construction site included, a signpost not) stands within this many map points of the hit.
 * Own rule, an approximation of "the village": about six cells, so a raid between the houses counts and
 * a woodcutter out at the forest's edge does not.
 */
export const SETTLEMENT_REACH_NODES = 12;
/** A hit joins the nearest standing fight of its place whose latest hit lies within this many map
 *  points, so a raid that moves through a village stays one card. Own rule, about fifteen cells. */
export const FIGHT_AREA_RADIUS_NODES = 30;
/** A fight is over once its area takes no hit for this long; its card retires and a later hit there
 *  starts a new fight. Own rule. */
export const FIGHT_QUIET_TICKS = 30 * TICKS_PER_SECOND;

/** Half-cell nodes per tile along each axis, for the tile box a node radius covers. */
const NODES_PER_TILE = 2;

function hexDistance(a: HalfCellNode, b: HalfCellNode): number {
  return hexDistanceBetween(a.hx, a.hy, b.hx, b.hy);
}

export const FIGHT_TYPE: Readonly<Record<FightPlace, UserMessageType>> = {
  settlement: USER_MESSAGE_TYPE.settlementAttacked,
  field: USER_MESSAGE_TYPE.peopleAttacked,
};

export type FightVictimKind = 'building' | 'wall' | 'settler' | 'vehicle';

export function isFightNote(m: Pick<UserMessage, 'type'>): boolean {
  return m.type === FIGHT_TYPE.settlement || m.type === FIGHT_TYPE.field;
}

/** One blow on the seat's own body, as {@link FightAreas.record} files it. */
export interface FightHit {
  readonly victim: number;
  readonly kind: FightVictimKind;
  readonly at: HalfCellNode;
  /** The striking side, or undefined for an unowned creature. */
  readonly attacker: number | undefined;
  readonly tick: number;
}

export interface FightArea {
  readonly id: number;
  readonly place: FightPlace;
  tally(): FightTally;
  /** The latest hit's node. */
  at(): HalfCellNode;
}

class Area implements FightArea {
  latest: HalfCellNode;
  lastHitTick: number;
  readonly counts: Record<FightVictimKind, number>;
  /** The bodies already counted. A restored area starts this empty, so a body struck before the restore
   *  and again after it counts twice. */
  readonly struck = new Set<number>();
  readonly seats: number[];
  wild: boolean;

  constructor(
    readonly id: number,
    readonly place: FightPlace,
    at: HalfCellNode,
    tick: number,
    from?: FightTally,
  ) {
    this.latest = at;
    this.lastHitTick = from?.lastHitTick ?? tick;
    this.counts = {
      building: from?.buildings ?? 0,
      wall: from?.walls ?? 0,
      settler: from?.settlers ?? 0,
      vehicle: from?.vehicles ?? 0,
    };
    this.seats = [...(from?.seats ?? [])];
    this.wild = from?.wild ?? false;
  }

  add(hit: FightHit): void {
    this.latest = hit.at;
    this.lastHitTick = hit.tick;
    if (!this.struck.has(hit.victim)) {
      this.struck.add(hit.victim);
      this.counts[hit.kind]++;
    }
    if (hit.attacker === undefined) this.wild = true;
    else if (!this.seats.includes(hit.attacker)) this.seats.push(hit.attacker);
  }

  tally(): FightTally {
    return {
      buildings: this.counts.building,
      walls: this.counts.wall,
      settlers: this.counts.settler,
      vehicles: this.counts.vehicle,
      seats: [...this.seats],
      wild: this.wild,
      lastHitTick: this.lastHitTick,
    };
  }

  at(): HalfCellNode {
    return this.latest;
  }
}

/**
 * Whether a hit at `at` on `victim` lands inside `player`'s settlement ({@link SETTLEMENT_REACH_NODES}).
 * Reads the snapshot's position buckets around the hit, so it costs the bodies near one hit.
 */
export function fightPlaceOf(
  snapshot: WorldSnapshot,
  player: number,
  kind: FightVictimKind,
  at: HalfCellNode,
): FightPlace {
  if (kind === 'building' || kind === 'wall') return 'settlement';
  const reachTiles = SETTLEMENT_REACH_NODES / NODES_PER_TILE;
  const x = at.hx / NODES_PER_TILE;
  const y = at.hy / NODES_PER_TILE;
  const near = positionedWithin(snapshot, {
    minX: x - reachTiles,
    minY: y - reachTiles,
    maxX: x + reachTiles,
    maxY: y + reachTiles,
  });
  const ownBuildingNear = near.some((e: SnapshotEntity) => {
    if (!(isBuilding(e) || isPalisade(e)) || ownerPlayerOf(e) !== player) return false;
    const pos = positionOf(e);
    return pos !== undefined && hexDistance(nodeOfPosition(pos.x, pos.y), at) <= SETTLEMENT_REACH_NODES;
  });
  return ownBuildingNear ? 'settlement' : 'field';
}

/**
 * The seat's standing fights: a few areas, each gathering the hits of one place within
 * {@link FIGHT_AREA_RADIUS_NODES}, dropped after {@link FIGHT_QUIET_TICKS} without one. Work follows the
 * hits: each one scans the standing areas, which only hits create.
 */
export class FightAreas {
  private areas: Area[] = [];
  private nextId = 1;

  /** File `hit` under the nearest standing fight of `place`, or start one; returns its area. */
  record(hit: FightHit, place: FightPlace): FightArea {
    this.prune(hit.tick);
    let best: Area | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const area of this.areas) {
      if (area.place !== place) continue;
      const distance = hexDistance(area.latest, hit.at);
      if (distance <= FIGHT_AREA_RADIUS_NODES && distance < bestDistance) {
        best = area;
        bestDistance = distance;
      }
    }
    if (best === undefined) {
      best = new Area(this.nextId++, place, hit.at, hit.tick);
      this.areas.push(best);
    }
    best.add(hit);
    return best;
  }

  /** Whether fight `id` still stands on `tick`. */
  isActive(id: number | null, tick: number): boolean {
    const area = this.areas.find((a) => a.id === id);
    return area !== undefined && tick - area.lastHitTick < FIGHT_QUIET_TICKS;
  }

  private prune(tick: number): void {
    if (this.areas.some((a) => tick - a.lastHitTick >= FIGHT_QUIET_TICKS)) {
      this.areas = this.areas.filter((a) => tick - a.lastHitTick < FIGHT_QUIET_TICKS);
    }
  }

  /**
   * The fights a feed's attack notes report, shown or dismissed, for a feed adopted from elsewhere (a HUD
   * remount, a seat switch), so its cards keep standing and new ids never reuse one of its notes'. A seat
   * left meanwhile filed no hits, so a fight it still has may read as over and come back as a new card.
   */
  static adopt(state: MessageFeedState | undefined): FightAreas {
    const fights = new FightAreas();
    for (const m of [...(state?.live ?? []), ...(state?.history ?? [])]) {
      if (!isFightNote(m) || m.about === null) continue;
      fights.nextId = Math.max(fights.nextId, m.about + 1);
      if (m.at === null || m.fight === undefined || fights.areas.some((a) => a.id === m.about)) continue;
      const place: FightPlace = m.type === FIGHT_TYPE.settlement ? 'settlement' : 'field';
      fights.areas.push(new Area(m.about, place, m.at, m.fight.lastHitTick, m.fight));
    }
    return fights;
  }
}
