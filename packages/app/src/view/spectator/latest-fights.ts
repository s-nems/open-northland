import {
  entityById,
  type HalfCellNode,
  hexDistanceBetween,
  type SimEvent,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ownerPlayerOf } from '../../game/snapshot/index.js';
import { FIGHT_AREA_RADIUS_NODES } from '../../hud/tool-panel/messages/fight-areas.js';

/** How many distinct fight spots the jump key cycles through. Own rule. */
export const FIGHT_SPOTS_KEPT = 5;

/** Where a fight between two seats last landed a blow. */
export interface FightSpot {
  readonly id: number;
  readonly at: HalfCellNode;
  readonly tick: number;
}

/**
 * The latest fights on the map, newest first: blows one seat lands on another's people or buildings.
 * A blow within {@link FIGHT_AREA_RADIUS_NODES} of a kept spot moves that spot to it, so one battle
 * stays one spot. A blow that kills on the tick it lands finds no victim left and counts for nothing;
 * a fight lands more than one.
 */
export interface LatestFights {
  /** Take one display frame's events, read against the snapshot they were stepped to. */
  record(events: readonly SimEvent[], snapshot: WorldSnapshot): void;
  /** The spot after `previous` (newest first, wrapping), or the newest when `previous` is null or gone. */
  next(previous: number | null): FightSpot | null;
}

export function createLatestFights(): LatestFights {
  const spots: FightSpot[] = [];
  let nextId = 0;

  const hit = (at: HalfCellNode, tick: number): void => {
    const near = spots.findIndex(
      (spot) => hexDistanceBetween(spot.at.hx, spot.at.hy, at.hx, at.hy) <= FIGHT_AREA_RADIUS_NODES,
    );
    const id = spots[near]?.id ?? nextId++;
    if (near >= 0) spots.splice(near, 1);
    spots.unshift({ id, at, tick });
    if (spots.length > FIGHT_SPOTS_KEPT) spots.length = FIGHT_SPOTS_KEPT;
  };

  const hostile = (
    snapshot: WorldSnapshot,
    attacker: number | undefined,
    target: number,
    collateral: boolean,
  ): boolean => {
    if (attacker === undefined || collateral) return false;
    const victim = entityById(snapshot, target);
    const owner = victim === undefined ? undefined : ownerPlayerOf(victim);
    return owner !== undefined && owner !== attacker;
  };

  return {
    record: (events, snapshot) => {
      for (const ev of events) {
        if (ev.kind === 'combatHit') {
          if (hostile(snapshot, ev.attackerPlayer, ev.target, false)) hit(ev.at, snapshot.tick);
        } else if (ev.kind === 'projectileHit') {
          if (hostile(snapshot, ev.shooterPlayer, ev.target, ev.collateral === true))
            hit(ev.at, snapshot.tick);
        }
      }
    },
    next: (previous) => {
      const at = previous === null ? -1 : spots.findIndex((spot) => spot.id === previous);
      return spots[at < 0 ? 0 : (at + 1) % spots.length] ?? null;
    },
  };
}
