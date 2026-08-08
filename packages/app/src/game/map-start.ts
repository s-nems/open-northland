import { fx, type WorldSnapshot } from '@open-northland/sim';
import { HUMAN_PLAYER } from './rules.js';
import { isBuilding, isSettler, ownerPlayerOf, positionOf, type SnapshotEntity } from './snapshot.js';

/**
 * The starting camera focus: the visual-tile `(col, row)` a decoded map opens centred on. Settlers rank
 * above buildings because a scenario scatters the player's own objective buildings across the whole map,
 * dragging a buildings-only centroid off the actual start.
 *
 * Named approximation: the original authors an explicit `misc.inc` `[misc_startpositions]`
 * `startposition <slot> <x> <y>`, but only about 8 of the 125 maps ship it, so it is not extracted.
 * Settlers are authored with distinct per-player `sethuman` slots, so the local player's centroid sits on
 * `startposition 0` wherever that record exists.
 *
 * Positions are fixed-point visual-tile coords, the same ones the renderer projects a bob through, so the
 * focus lands on the drawn anchor.
 */
export function mapStartFocus(
  snapshot: WorldSnapshot,
  mapWidth: number,
  mapHeight: number,
  // The controlled seat; scenes and roster-less maps keep the default.
  localPlayer: number = HUMAN_PLAYER,
): { x: number; y: number } {
  const centroidOf = (keep: (e: SnapshotEntity) => boolean): { x: number; y: number } | null => {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const e of snapshot.entities) {
      if (!keep(e)) continue;
      const p = positionOf(e);
      if (p === undefined) continue;
      sumX += fx.toFloat(p.x);
      sumY += fx.toFloat(p.y);
      count++;
    }
    return count > 0 ? { x: sumX / count, y: sumY / count } : null;
  };
  return (
    centroidOf((e) => isSettler(e) && ownerPlayerOf(e) === localPlayer) ??
    centroidOf((e) => isBuilding(e) && ownerPlayerOf(e) === localPlayer) ??
    centroidOf((e) => isSettler(e) || isBuilding(e)) ?? { x: mapWidth / 2, y: mapHeight / 2 }
  );
}
