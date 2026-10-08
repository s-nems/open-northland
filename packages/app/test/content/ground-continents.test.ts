import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTerrainMap } from '@open-northland/data';
import { buildTerrainGraph, type NodeId } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildCollisionTerrain } from '../../src/content/collision.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * The ground our movers connect against the original's continents. Every map's `lmco` lane numbers
 * each node's continent, 0 for void and for pockets too small to number: ground of one kind joined
 * node to node, so a continent can run through the map frame or across an edge a rock triangle cuts,
 * where no walker or ship of the original passes. A component of ours therefore may split a
 * continent, never hold two. With the map's objects stripped, as the lane is computed, a regression in
 * the ground classes or the edge rule welds them.
 */

/** Nodes of one continent a component may hold without counting as joined to it: a lane saved before
 *  the map's last edit leaves a few nodes labelled with a continent they no longer touch. */
const STRAY_NODES = 5;
/** Welds the corpus may show where a map's saved continent lane is stale as a whole: on
 *  `kraina_tysisca_jezior_1_1` the original's own edge lane joins two lakes the continent lane
 *  numbers apart. */
const STALE_CONTINENT_WELDS = 1;

/** Building every graph of the ~125-map corpus takes tens of seconds; sized as a hang guard. */
const CORPUS_TIMEOUT_MS = 600_000;

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

/** Decoded map grids: a dotted stem is a sidecar (`.meta.json`, `.script.json` and the like). */
function mapFiles(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith('.json') && !f.slice(0, -'.json'.length).includes('.'))
    .sort();
}

describe.runIf(hasRealIr() && existsSync(mapsDir()))(
  'ground connectivity against the original continents',
  () => {
    it(
      'never joins two continents into one component',
      async () => {
        const { merge } = await loadContentUnderTest();
        const ir = rawIrUnderTest() as ContentIr;
        const welds: string[] = [];
        let compared = 0;
        for (const file of mapFiles()) {
          const map = parseTerrainMap(JSON.parse(readFileSync(resolve(mapsDir(), file), 'utf8')));
          const continents = map.continents;
          if (continents === undefined || map.ground === undefined) continue;
          compared++;
          const { objects: _objects, ...ground } = map;
          const graph = buildTerrainGraph(merge.content, buildCollisionTerrain(ground, ir));
          const continentsOf = new Map<number, Map<number, number>>();
          for (let i = 0; i < graph.nodeCount; i++) {
            const node = i as NodeId;
            const continent = continents[i] ?? 0;
            // A node no mover stands on, the frame's among them, belongs to no component.
            if (continent === 0 || !(graph.isWalkable(node) || graph.isWater(node))) continue;
            const component = graph.componentOf(node);
            let held = continentsOf.get(component);
            if (held === undefined) {
              held = new Map();
              continentsOf.set(component, held);
            }
            held.set(continent, (held.get(continent) ?? 0) + 1);
          }
          for (const held of continentsOf.values()) {
            const joined = [...held]
              .filter(([, nodes]) => nodes > STRAY_NODES)
              .map(([continent]) => continent);
            if (joined.length > 1) welds.push(`${file}: continents ${joined.join(', ')}`);
          }
        }
        expect(compared).toBeGreaterThan(0);
        expect(welds.length, welds.join('\n')).toBeLessThanOrEqual(STALE_CONTINENT_WELDS);
      },
      CORPUS_TIMEOUT_MS,
    );
  },
);
