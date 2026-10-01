import {
  AI_GATE_LIST_LIMIT,
  type AiGateRecord,
  diplomacyStance,
  Health,
  Owner,
  ownerOf,
  Palisade,
  Position,
  UnderConstruction,
  Vehicle,
} from '../../components/index.js';
import type { PlayerCommand } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';
import { nearestRaiderWithin, type Raider } from '../ai-player/military/defence/threat.js';

/** How close an enemy fighter or vehicle comes before the handler shuts a gate, in map points.
 *  Original behavior. */
export const GATE_ENEMY_NEAR_POINTS = 40;

/**
 * The gates the handler watches, taken once on its first turn: every gate on the map, whoever holds
 * it, nearest the seat's centre first, each remembered as it stands. Original behavior; the original
 * walks rings out from the centre, which this build orders by distance, ties by entity id.
 */
export function gateList(world: World, centre: { hx: number; hy: number } | null): AiGateRecord[] {
  if (centre === null) return [];
  const found: { record: AiGateRecord; distance: number }[] = [];
  for (const e of world.canonicalQuery(Palisade, Position)) {
    const gate = world.get(e, Palisade).gate;
    if (gate === null) continue;
    const at = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(at.x, at.y);
    found.push({
      record: { gate: e, open: gate.open },
      distance: hexDistanceBetween(centre.hx, centre.hy, hx, hy),
    });
  }
  found.sort((a, b) => a.distance - b.distance);
  return found.slice(0, AI_GATE_LIST_LIMIT).map((f) => f.record);
}

/**
 * Every handler turn: shut each standing gate of the seat with an enemy fighter or vehicle within
 * {@link GATE_ENEMY_NEAR_POINTS}, open it again once none is. Original behavior: the handler opens
 * only a gate it shut itself, so a gate a script closed in peace stays closed.
 *
 * Deviation: the original counts every adult enemy, civilians included; this build counts the
 * fighters the seat's defence watches, so a passing builder does not lock the town. While an enemy
 * stays, an open gate is shut again every turn: a shut the gate refused (someone stood in it) is
 * retried, where the original's unconditional swap needs no retry, and a script opening it then loses.
 */
export function gateOrders(
  world: World,
  seat: number,
  gates: AiGateRecord[],
  raiders: () => readonly Raider[],
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  let vehicleList: readonly { hx: number; hy: number }[] | null = null;
  const vehicles = (): readonly { hx: number; hy: number }[] => (vehicleList ??= enemyVehicles(world, seat));
  for (const record of gates) {
    const gate = world.tryGet(record.gate, Palisade)?.gate;
    if (
      gate === undefined ||
      gate === null ||
      ownerOf(world, record.gate) !== seat ||
      world.has(record.gate, UnderConstruction)
    ) {
      continue;
    }
    const at = world.get(record.gate, Position);
    const { hx, hy } = nodeOfPosition(at.x, at.y);
    const near =
      nearestRaiderWithin(raiders(), hx, hy, GATE_ENEMY_NEAR_POINTS, null) !== null ||
      vehicles().some((v) => hexDistanceBetween(v.hx, v.hy, hx, hy) <= GATE_ENEMY_NEAR_POINTS);
    if (!near) {
      if (!record.open) commands.push({ kind: 'setPalisadeGate', palisade: record.gate, open: true });
      record.open = true;
    } else if (record.open || gate.open) {
      commands.push({ kind: 'setPalisadeGate', palisade: record.gate, open: false });
      record.open = false;
    }
  }
  return commands;
}

/** The nodes of the enemy vehicles standing on the map; a carried one has no position. */
function enemyVehicles(world: World, seat: number): { hx: number; hy: number }[] {
  const found: { hx: number; hy: number }[] = [];
  for (const e of world.query(Vehicle, Owner, Position)) {
    if (diplomacyStance(world, world.get(e, Owner).player, seat) !== 'enemy') continue;
    if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) continue;
    const at = world.get(e, Position);
    found.push(nodeOfPosition(at.x, at.y));
  }
  return found;
}
