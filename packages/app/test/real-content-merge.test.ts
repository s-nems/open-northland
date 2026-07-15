import { type ContentSet, parseContentSet } from '@open-northland/data';
import { buildTerrainGraph, halfCellMapFromCells } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { WOOD_CHOPS_TO_FELL, WOOD_YIELD_PER_NODE } from '../src/catalog/felling.js';
import { MINE_LEVELS, STONE_DEPOSIT_UNITS } from '../src/catalog/mining.js';
import {
  NAV_LANDSCAPE_TYPES,
  TERRAIN_BARREN,
  TERRAIN_BLOCKED,
  TERRAIN_IMPASSABLE,
  TERRAIN_MARGIN,
  TERRAIN_OPEN,
} from '../src/catalog/terrain.js';
import { mergeRealContent } from '../src/content/real-content.js';
import { sandboxContent } from '../src/game/sandbox/index.js';

/**
 * `mergeRealContent` is exercised on a clean-room stand-in for raw ir.json — never the copyrighted content.
 * We take the sandbox ContentSet and zero its gathering balance the way the pipeline ships it
 * (`extractGoodGathering` emits 0), then add one gathered good with no clean-room balance and one building
 * beyond the clean-room catalog, so the gap surfacing has something to report.
 */
function goodById(content: ContentSet, id: string) {
  const good = content.goods.find((g) => g.id === id);
  if (good === undefined) throw new Error(`fixture: good '${id}' missing`);
  return good;
}

function rawRealLike(): ContentSet {
  const base = sandboxContent();
  const zeroGathering = (g: ContentSet['goods'][number]) =>
    g.gathering === undefined
      ? g
      : {
          ...g,
          gathering: { ...g.gathering, chopsToFell: 0, yieldPerNode: 0, depositSize: 0, depositLevels: 0 },
        };
  // A gathered good (wood's shape) whose string id is absent from GATHERING_BALANCE_BY_ID — stays uncalibrated.
  const unbalanced = zeroGathering({ ...goodById(base, 'wood'), typeId: 900, id: 'testberry' });
  // A building absent from VIKING_BUILDINGS (headquarters' shape, a fresh id) — uncataloged.
  const firstBuilding = base.buildings[0];
  if (firstBuilding === undefined) throw new Error('fixture: no buildings');
  const uncataloged = { ...firstBuilding, typeId: 900, id: 'wonder_test' };
  return parseContentSet({
    ...base,
    goods: [...base.goods.map(zeroGathering), unbalanced],
    buildings: [...base.buildings, uncataloged],
  });
}

describe('mergeRealContent', () => {
  it('pins the clean-room felling/mining balance into the zeroed gathering blocks', () => {
    const raw = rawRealLike();
    // Precondition: the stand-in ships dead gathering, like real ir.json.
    expect(goodById(raw, 'wood').gathering?.chopsToFell).toBe(0);
    expect(goodById(raw, 'stone').gathering?.depositSize).toBe(0);

    const { content } = mergeRealContent(raw);

    const wood = goodById(content, 'wood').gathering;
    expect(wood?.chopsToFell).toBe(WOOD_CHOPS_TO_FELL);
    expect(wood?.yieldPerNode).toBe(WOOD_YIELD_PER_NODE);
    expect(wood?.bioLandscape).toBe(true); // extracted field preserved, not overwritten

    const stone = goodById(content, 'stone').gathering;
    expect(stone?.depositSize).toBe(STONE_DEPOSIT_UNITS);
    expect(stone?.depositLevels).toBe(MINE_LEVELS);
  });

  it('leaves non-gathered goods untouched', () => {
    const { content } = mergeRealContent(rawRealLike());
    expect(goodById(content, 'coin').gathering).toBeUndefined();
  });

  it('surfaces gathered goods it has no balance for, and buildings beyond the clean-room catalog', () => {
    const { unbalancedGoods, uncatalogedBuildings } = mergeRealContent(rawRealLike());
    expect(unbalancedGoods).toContain('testberry');
    expect(unbalancedGoods).not.toContain('wood'); // wood has a clean-room balance
    expect(uncatalogedBuildings).toEqual(['wonder_test']);
  });

  it('injects the sim nav-terrain classes so a collision-resolved grid navigates on real content', () => {
    // Real ir.json's `landscape` is the detailed types (1..87) — none of the sim's semantic nav classes.
    // Strip them from the stand-in to reproduce that gap, then prove the merge closes it.
    const navIds = new Set(NAV_LANDSCAPE_TYPES.map((t) => t.typeId));
    const raw = rawRealLike();
    const realLike = parseContentSet({
      ...raw,
      landscape: raw.landscape.filter((t) => !navIds.has(t.typeId)),
    });
    // A grid in the collision-class vocabulary (what `content/collision.ts` + scene grids emit).
    const grid = halfCellMapFromCells({
      width: 5,
      height: 1,
      typeIds: [TERRAIN_OPEN, TERRAIN_IMPASSABLE, TERRAIN_BLOCKED, TERRAIN_MARGIN, TERRAIN_BARREN],
    });
    // Precondition: without the merge the sim throws exactly the blocker this ticket fixes.
    expect(() => buildTerrainGraph(realLike, grid)).toThrow(/absent from content/);

    const { content } = mergeRealContent(realLike);
    for (const cls of [TERRAIN_OPEN, TERRAIN_IMPASSABLE, TERRAIN_BLOCKED, TERRAIN_MARGIN, TERRAIN_BARREN]) {
      expect(content.landscape.some((t) => t.typeId === cls)).toBe(true);
    }
    // The open class stays plantable (the farmer drive's field gate) and impassable stays unwalkable.
    expect(content.landscape.find((t) => t.typeId === TERRAIN_OPEN)?.plantable).toBe(true);
    expect(content.landscape.find((t) => t.typeId === TERRAIN_IMPASSABLE)?.walkable).toBe(false);
    expect(() => buildTerrainGraph(content, grid)).not.toThrow();
  });
});
