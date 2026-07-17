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
const WOOD = 'wood';
const STONE = 'stone';
const ANCHOR = { hx: 20, hy: 20 };

function grassMap(cells: number) {
  return halfCellMapFromCells({
    width: cells,
    height: cells,
    typeIds: new Array(cells * cells).fill(TERRAIN_OPEN),
  });
}

/**
 * A decoded map authors each gatherer's resource pick as a `setproducedgood` in its `sethuman` block
 * (819 across the decoded corpus), and it must survive the whole import chain — the map decoder, the
 * name→typeId join, the `spawnSettler` command — onto the settler's auto-planted `WorkFlag.goodType`.
 * The real-content twin of the synthetic sim cases: same rule, but over the real goodtype/jobtype name
 * join, so a renamed or rescoped id surfaces here instead of silently reverting every imported
 * collector to gather-everything.
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
        {
          role: COLLECTOR,
          tribe: 'viking',
          player: HUMAN_PLAYER,
          hx: ANCHOR.hx,
          hy: ANCHOR.hy,
          producedGood: '„gold”',
        },
        { role: COLLECTOR, tribe: 'viking', player: HUMAN_PLAYER, hx: 26, hy: 26 }, // no pick authored
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

    // All four collectors resolved — a dropped join would pass the picks assertion vacuously.
    const settlers = [...sim.world.query(Settler)];
    expect(settlers.length).toBe(4);
    // Every collector carries an auto-planted flag; only the two resolvable picks narrow it.
    const picks = settlers.map((e) => sim.world.tryGet(e, WorkFlag)?.goodType);
    expect(picks).toEqual([goodTypeOf(WOOD), goodTypeOf(STONE), undefined, undefined]);
  });
});
