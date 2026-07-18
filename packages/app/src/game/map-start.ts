import { fx, type WorldSnapshot } from '@open-northland/sim';
import { HUMAN_PLAYER } from './rules.js';
import { isBuilding, isSettler, ownerPlayerOf, positionOf, type SnapshotEntity } from './snapshot.js';

/**
 * The starting camera focus — the visual-tile `(col, row)` a decoded map opens centred on, so entering a
 * map lands on the player's start (the "startowa pozycja") instead of the top-left corner. Priority:
 *
 *   1. the human player's settlers centroid — a scenario's own starting units spawn at/around its
 *      headquarters (`kwatera`), so their centre is the base;
 *   2. the human player's buildings centroid — a base placed with no starting units;
 *   3. any placed settler/building — a foreign-owned-only map (nothing is ours to prefer);
 *   4. the map centre — a plain imported map with no authored entities at all.
 *
 * Settlers rank above buildings because a scenario scatters objective and enemy buildings across the whole
 * map (tutorial_003 places a farm cluster far from the player's HQ), dragging a buildings-only centroid off
 * the actual start.
 *
 * Named approximation (golden rule #5): the original authors an explicit start point —
 * `misc.inc` `[misc_startpositions]` `startposition <slot> <x> <y>`, slot 0 = the human — but only ~8 of
 * the 125 maps ship it (magiczny_las, and most single-player maps, comment the section out), so it is not
 * extracted. The HUMAN_PLAYER settler centroid stands in and matches it wherever it exists: on every
 * startposition-bearing map the settlers are authored with distinct per-player slots
 * (`sethuman <player> …`), so filtering to `HUMAN_PLAYER` (= `sethuman` player 0) leaves just the human's
 * own cluster, which sits on `startposition 0` (verified on Battle_for_the_Four_Hills et al). Extracting
 * `startposition 0` and preferring it would be a faithful refinement, but buys nothing over the centroid
 * on the current corpus.
 *
 * Harvestable map resources carry no Settler/Building marker, so they never pull the focus. Positions are
 * fixed-point visual-tile coords — the same `fx.toFloat` the renderer divides by to project a bob (see
 * `render`'s `sprite-scene.ts`), so the focus lands on the drawn anchor. Deliberately not unified with
 * `view/camera/frame.ts` `cameraFor`'s inspection-zoom policy: the inputs differ (snapshot entities vs projected
 * draw items).
 */
export function mapStartFocus(
  snapshot: WorldSnapshot,
  mapWidth: number,
  mapHeight: number,
  // The controlled seat — the menu's roster pick; scenes and roster-less maps keep the default.
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
