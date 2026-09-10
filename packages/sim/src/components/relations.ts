import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { playerBit } from './match.js';
import { isValidPlayer } from './ownership.js';

const diplomacyLocks = defineWorldSingleton<{
  /** player → the slots its stance toward is locked, a bitmask held in both rows of a pair. */
  locked: Map<number, number>;
}>('DiplomacyLocks', () => ({ locked: new Map() }));

/**
 * The pairs a map script marked not changeable (`SetDiplomacyNotChangeableFlag`). A script's own
 * `SetDiplomacy` writes through a lock, as the original's setter does; a seat's stance order is the
 * reader the lock waits for.
 */
export const DiplomacyLocks = diplomacyLocks.component;

export function diplomacyLocked(world: World, a: number, b: number): boolean {
  if (!isValidPlayer(a) || !isValidPlayer(b)) return false;
  return ((diplomacyLocks.read(world).locked.get(a) ?? 0) & playerBit(b)) !== 0;
}

/** Lock or unlock the pair in both directions. An invalid slot is skipped; an unchanged pair takes no
 *  write, so re-locking never dirties the snapshot. */
export function setDiplomacyLock(world: World, a: number, b: number, locked: boolean): void {
  if (!isValidPlayer(a) || !isValidPlayer(b) || diplomacyLocked(world, a, b) === locked) return;
  diplomacyLocks.write(world, (state) => {
    setLockBit(state.locked, a, b, locked);
    setLockBit(state.locked, b, a, locked);
  });
}

function setLockBit(rows: Map<number, number>, row: number, column: number, locked: boolean): void {
  const bits = rows.get(row) ?? 0;
  rows.set(row, locked ? bits | playerBit(column) : bits & ~playerBit(column));
}

const playerAttacks = defineWorldSingleton<{
  /** victim player → bitmask of the players whose blows have damaged one of its humans. */
  attackedBy: Map<number, number>;
}>('PlayerAttacks', () => ({ attackedBy: new Map() }));

/**
 * Who has struck whom: a damaging blow on a player's human marks the attacker in the victim's row, one
 * direction only, and the mark never clears (reading of the original's damage callback). The
 * `PlayerAttackedByPlayer` goal reads it.
 */
export const PlayerAttacks = playerAttacks.component;

export function wasAttackedBy(world: World, victim: number, attacker: number): boolean {
  if (!isValidPlayer(victim) || !isValidPlayer(attacker)) return false;
  return ((playerAttacks.read(world).attackedBy.get(victim) ?? 0) & playerBit(attacker)) !== 0;
}

/** Record a blow of `attacker`'s unit on `victim`'s human. A self-inflicted blow, an unowned side, or
 *  a mark already held is skipped, so the singleton materializes only on a real first strike. */
export function recordPlayerAttack(
  world: World,
  victim: number | undefined,
  attacker: number | undefined,
): void {
  if (victim === undefined || attacker === undefined || victim === attacker) return;
  if (!isValidPlayer(victim) || !isValidPlayer(attacker) || wasAttackedBy(world, victim, attacker)) return;
  playerAttacks.write(world, (state) => {
    state.attackedBy.set(victim, (state.attackedBy.get(victim) ?? 0) | playerBit(attacker));
  });
}
