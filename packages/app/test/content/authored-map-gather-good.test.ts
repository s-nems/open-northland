import { components, halfCellMapFromCells } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { runAuthoredSlice } from '../../src/slice/vertical-slice.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

const { Settler, WorkFlag } = components;

const MAP_CELLS = 40;
/** The real `[jobtype]` slug and goodtype names a decoded map authors — the join keys, not sim typeIds. */
const COLLECTOR = 'collector';
const FISHER = 'fisher';
const WOOD = 'wood';
const STONE = 'stone';
const FISH = 'fish';

function grassMap(cells: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(TERRAIN_OPEN),
  });
}

/**
 * A decoded map authors each human's produced good as a `setproducedgood` in its `sethuman` block (819
 * across the decoded corpus). This covers the half after the decoder — the name→typeId join and the
 * `spawnSettler` command — landing a pick on the settler's auto-planted `WorkFlag.goodType` (the
 * decoder's own half is pinned in `tools/asset-pipeline/test/ini-maps.test.ts`). The real-content twin
 * of the synthetic sim cases: same rule, but over the real goodtype/jobtype name join, so a renamed or
 * rescoped id surfaces here instead of silently reverting every imported collector to gather-everything.
 */
describe.runIf(hasRealIr())('authored decoded-map gatherers — the setproducedgood pick', () => {
  it('lands each authored pick on its own collector, and an unknown pick gathers everything', async () => {
    const { merge } = await loadContentUnderTest();
    const entities = {
      buildings: [],
      humans: [
        { role: COLLECTOR, tribe: 'viking', player: HUMAN_PLAYER, hx: 10, hy: 10, producedGood: WOOD },
        { role: COLLECTOR, tribe: 'viking', player: HUMAN_PLAYER, hx: 16, hy: 16, producedGood: STONE },
        // The `„gold”` shape one real map authors (typographic quotes): unresolvable, so the collector
        // keeps the gather-everything default rather than costing the map its settler.
        { role: COLLECTOR, tribe: 'viking', player: HUMAN_PLAYER, hx: 20, hy: 20, producedGood: '„gold”' },
        { role: COLLECTOR, tribe: 'viking', player: HUMAN_PLAYER, hx: 26, hy: 26 }, // no pick authored
        // A real corpus shape the sim has no home for (62 rows): `fish` carries no harvest atomic and a
        // fisher gets no work flag, so the pick drops. A known limitation, not a join failure
        // (`stampGatherGood` names it) — pinned so it surfaces if fishing ever becomes flag work.
        { role: FISHER, tribe: 'viking', player: HUMAN_PLAYER, hx: 30, hy: 30, producedGood: FISH },
      ],
      animals: [],
    };
    const rows = {
      buildings: merge.content.buildings.map((b) => ({ typeId: b.typeId, id: b.id, kind: b.kind })),
      jobs: merge.content.jobs.map((j) => ({ typeId: j.typeId, id: j.id, name: j.id })),
      tribes: merge.content.tribes.map((t) => ({ typeId: t.typeId, id: t.id })),
      goods: merge.content.goods.map((g) => ({ typeId: g.typeId, id: g.id, name: g.id })),
    };
    const goodTypeOf = (id: string): number => {
      const good = merge.content.goods.find((g) => g.id === id);
      if (good === undefined) throw new Error(`the real content has no \`${id}\` good`);
      return good.typeId;
    };

    const sim = runAuthoredSlice(
      7,
      1,
      grassMap(MAP_CELLS),
      entities,
      rows,
      undefined,
      undefined,
      merge.content,
    );
    expect(sim).not.toBeNull();
    if (sim === null) return;

    // All five humans resolved — a dropped join would pass the picks assertion vacuously.
    const settlers = [...sim.world.query(Settler)];
    expect(settlers.length).toBe(5);
    // Only the two flag-harvestable picks narrow a flag; the rest keep the gather-everything default.
    const picks = settlers.map((e) => sim.world.tryGet(e, WorkFlag)?.goodType);
    expect(picks).toEqual([goodTypeOf(WOOD), goodTypeOf(STONE), undefined, undefined, undefined]);
    // The fisher's drop is the trade carrying no work flag at all, not a narrowed one.
    const fisher = settlers[4];
    if (fisher === undefined) throw new Error('the authored fisher did not resolve');
    expect(sim.world.has(fisher, WorkFlag)).toBe(false);
  });
});
