import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript } from '@open-northland/data';
import { PLACING_PAPER_KINDS } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { paperOfSpecialItem } from '../../src/game/starting-papers.js';
import { contentDir, hasRealIr, loadContentUnderTest } from './helpers.js';
import { realMapWorld } from './real-map-world.js';

/**
 * Pin the `[specialItems]` starting papers against the real decoded maps: every authored row must name a
 * kind the plans tab can spend and a house the content knows, else a map's opening papers would sit
 * inert or place nothing, and the corpus map every player opens with three "any house" papers must
 * hand them out through the same world build the browser runs.
 */

const THREE_PAPERS_MAP = 'diamentowa_dolina';
const PAPERS_PER_PLAYER = 3;
const HUMAN_SEAT = 0;
/** Zod over the whole map set takes seconds; a hang-guard, not a benchmark. */
const MAP_WORLD_TIMEOUT_MS = 180_000;

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

function scriptFiles(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith('.script.json'))
    .sort();
}

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'maps')))(
  'starting papers on real maps',
  () => {
    it('every authored row spends on a placement and names a house the content builds', async () => {
      const { merge } = await loadContentUnderTest();
      const houses = new Set(merge.content.buildings.map((b) => b.typeId));
      let rows = 0;
      for (const file of scriptFiles()) {
        const script = MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), file), 'utf8')));
        for (const row of script.specialItems) {
          rows++;
          const paper = paperOfSpecialItem(row);
          expect(paper, `${file}: ${JSON.stringify(row)}`).toBeDefined();
          if (paper === undefined) continue;
          expect(PLACING_PAPER_KINDS.has(paper.kind), `${file}: ${paper.kind}`).toBe(true);
          if (paper.kind !== 'placeAny')
            expect(houses.has(paper.param), `${file}: house ${paper.param}`).toBe(true);
        }
      }
      expect(rows).toBeGreaterThan(0);
    });

    it(
      `${THREE_PAPERS_MAP} opens with ${PAPERS_PER_PLAYER} "any house" papers per player`,
      async () => {
        const { sim } = await realMapWorld({
          mapId: THREE_PAPERS_MAP,
          aiSeats: [],
          humanSeats: [HUMAN_SEAT],
        });
        expect(sim.papers(HUMAN_SEAT)).toEqual(
          Array.from({ length: PAPERS_PER_PLAYER }, () => ({ kind: 'placeAny', param: 0 })),
        );
      },
      MAP_WORLD_TIMEOUT_MS,
    );
  },
);
