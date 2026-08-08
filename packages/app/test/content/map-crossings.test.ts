import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  footprintCellDx,
  fullStateBlockAreaCells,
  type LandscapeBlockArea,
  parseTerrainMap,
} from '@open-northland/data';
import { buildTerrainGraph, findPath, type NodeId } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildCollisionTerrain } from '../../src/content/collision.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * River crossings on the real decoded maps. A bridge is a parapet outline whose corridor runs over
 * cells the mapmaker painted half land, half water; the collision join has to keep both open at once
 * (`content/collision.ts`) or the deck stops being a crossing. The synthetic fixture in
 * `collision.test.ts` pins the rule, this pins that the corpus still satisfies it end to end.
 */

/** Named crossings from the owned corpus: map id, `[GfxLandscape]` EditName, and the half-cell node
 *  the map places it on. A corpus that moves one fails the placement assertion, not the routing one. */
const CROSSINGS = [
  { map: 'flagomania_1_0_01', object: 'bridge wood 01', hx: 246, hy: 112 },
  { map: 'zgielk2', object: 'bridge small 01', hx: 224, hy: 71 },
  { map: 'straznicypolnocy', object: 'bridge small 02', hx: 350, hy: 218 },
  { map: 'zgielk2', object: 'bridge wood 02', hx: 66, hy: 89 },
] as const;

/** How far past a deck's end to look for its bank, in half-cell rows. Deep enough to clear the
 *  abutment's own build margin, shallow enough to stay on the near shore. */
const BANK_SEARCH_ROWS = 16;

/** Whichever crossing runs first pays the cold `loadContentUnderTest()` join; the rest reuse it. */
const REAL_CONTENT_TIMEOUT_MS = 60_000;

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'maps')))('real-map crossings', () => {
  for (const crossing of CROSSINGS) {
    const name = `${crossing.object} on ${crossing.map} joins its two banks over the deck`;
    it(name, { timeout: REAL_CONTENT_TIMEOUT_MS }, async () => {
      const { merge } = await loadContentUnderTest();
      const ir = rawIrUnderTest() as ContentIr;
      const mapPath = resolve(contentDir(), `maps/${crossing.map}.json`);
      const map = parseTerrainMap(JSON.parse(readFileSync(mapPath, 'utf8')));

      const objects = map.objects;
      if (objects === undefined) throw new Error(`${crossing.map} carries no object lane`);
      const typeIndex = objects.types.indexOf(crossing.object);
      expect(typeIndex, `${crossing.map} no longer places '${crossing.object}'`).toBeGreaterThanOrEqual(0);
      let placed = false;
      for (let i = 0; i + 2 < objects.placements.length; i += 3) {
        if (objects.placements[i + 2] !== typeIndex) continue;
        if (objects.placements[i] === crossing.hx && objects.placements[i + 1] === crossing.hy) placed = true;
      }
      expect(placed, `'${crossing.object}' no longer sits at (${crossing.hx},${crossing.hy})`).toBe(true);

      const gfx = ir.landscapeGfx?.find((g) => g.editName === crossing.object);
      const deck = fullStateBlockAreaCells(gfx?.walkBlockAreas as readonly LandscapeBlockArea[] | undefined);
      expect(deck.length, `'${crossing.object}' has no walk area to cross`).toBeGreaterThan(0);
      const dys = deck.map((c) => c.dy);
      const dxs = deck.map((c) => c.dx);
      const [minDy, maxDy] = [Math.min(...dys), Math.max(...dys)];
      const [minDx, maxDx] = [Math.min(...dxs), Math.max(...dxs)];

      const grid = buildCollisionTerrain(map, ir);
      const graph = buildTerrainGraph(merge.content, grid);
      const walkableAt = (dx: number, dy: number): NodeId | null => {
        const x = crossing.hx + footprintCellDx(crossing.hy, { dx, dy });
        const y = crossing.hy + dy;
        if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
        const node = graph.nodeAt(x, y);
        return graph.componentOf(node) >= 0 ? node : null;
      };
      /** The first walkable node past one end of the deck, scanning outwards across its width. */
      const bank = (from: number, step: number): NodeId | null => {
        for (let k = 1; k <= BANK_SEARCH_ROWS; k++) {
          for (let dx = minDx; dx <= maxDx; dx++) {
            const node = walkableAt(dx, from + step * k);
            if (node !== null) return node;
          }
        }
        return null;
      };
      const near = bank(minDy, -1);
      const far = bank(maxDy, 1);
      expect(near, 'no walkable node past the deck’s far end').not.toBeNull();
      expect(far, 'no walkable node past the deck’s near end').not.toBeNull();
      if (near === null || far === null) return;

      const route = findPath(graph, near, far);
      expect(route, 'the two banks no longer route into each other').not.toBeNull();
      // And the route crosses the deck rather than walking round the whole water body: at least one
      // of its nodes sits inside the deck's own span.
      const overDeck = (route ?? []).some((node) => {
        const dy = Math.floor(node / grid.width) - crossing.hy;
        if (dy < minDy || dy > maxDy) return false;
        const x = node % grid.width;
        return (
          x >= crossing.hx + footprintCellDx(crossing.hy, { dx: minDx, dy }) &&
          x <= crossing.hx + footprintCellDx(crossing.hy, { dx: maxDx, dy })
        );
      });
      expect(overDeck, 'the banks connect somewhere else, not over this deck').toBe(true);
    });
  }
});
