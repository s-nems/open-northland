import { type ContentSet, parseContentSet } from '@open-northland/data';
import { flatTileColour } from '@open-northland/render';
import { buildTerrainGraph, halfCellMapFromCells } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { FARMING_BALANCE_BY_ID } from '../src/catalog/farming.js';
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
import { HUMAN_HITPOINTS } from '../src/catalog/units.js';
import { loadRuntimeRealContent, logRealContentGaps, mergeRealContent } from '../src/content/real-content.js';
import { diag } from '../src/diag/log.js';
import { sandboxContent } from '../src/game/sandbox/index.js';

/**
 * `mergeRealContent` is exercised on a clean-room stand-in for raw ir.json — never the copyrighted content.
 * We take the sandbox ContentSet and reproduce the way the pipeline ships it — gathering balance zeroed
 * (`extractGoodGathering` emits 0) and farmed goods carrying their field atomics but NO `farming` block
 * (no readable growth timing) — then add one gathered good with no clean-room balance, one field good with
 * none, and one building beyond the clean-room catalog, so the gap surfacing has something to report.
 */
function goodById(content: ContentSet, id: string) {
  const good = content.goods.find((g) => g.id === id);
  if (good === undefined) throw new Error(`fixture: good '${id}' missing`);
  return good;
}

// typeIds past the real 1..87 range; goods and buildings are separate id spaces, so one base value serves
// both (the extra field good takes the next id).
const OUT_OF_CATALOG_TYPE_ID = 900;

function rawRealLike(): ContentSet {
  const base = sandboxContent();
  const zeroGathering = (g: ContentSet['goods'][number]) =>
    g.gathering === undefined
      ? g
      : {
          ...g,
          gathering: { ...g.gathering, chopsToFell: 0, yieldPerNode: 0, depositSize: 0, depositLevels: 0 },
        };
  // Real ir.json ships a farmed good with its field atomics but no clean-room `farming` block — strip it
  // so the merge has to re-add it (and so a field good with none surfaces as a gap).
  const stripFarming = (g: ContentSet['goods'][number]) => {
    if (g.farming === undefined) return g;
    const { farming: _farming, ...rest } = g;
    return rest;
  };
  // A gathered good (wood's shape) whose string id is absent from GATHERING_BALANCE_BY_ID — stays uncalibrated.
  const unbalanced = zeroGathering({
    ...goodById(base, 'wood'),
    typeId: OUT_OF_CATALOG_TYPE_ID,
    id: 'testberry',
  });
  // A field-farmed good (wheat's three field atomics) whose id is absent from FARMING_BALANCE_BY_ID — the
  // overlay cannot complete it, so it surfaces as an unfarmed field good.
  const unfarmed = {
    ...stripFarming(goodById(base, 'wheat')),
    typeId: OUT_OF_CATALOG_TYPE_ID + 1,
    id: 'testherb',
  };
  // A building absent from VIKING_BUILDINGS (headquarters' shape, a fresh id) — uncataloged.
  const firstBuilding = base.buildings[0];
  if (firstBuilding === undefined) throw new Error('fixture: no buildings');
  const uncataloged = { ...firstBuilding, typeId: OUT_OF_CATALOG_TYPE_ID, id: 'wonder_test' };
  return parseContentSet({
    ...base,
    goods: [...base.goods.map((g) => stripFarming(zeroGathering(g))), unbalanced, unfarmed],
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

  it('re-adds the clean-room farming block to a farmed good the pipeline shipped without one', () => {
    const raw = rawRealLike();
    expect(goodById(raw, 'wheat').farming).toBeUndefined(); // stand-in ships no block, like real ir.json
    const { content } = mergeRealContent(raw);
    expect(goodById(content, 'wheat').farming).toEqual(FARMING_BALANCE_BY_ID.wheat);
  });

  it('surfaces gathered/field goods it cannot complete, and buildings beyond the clean-room catalog', () => {
    const { unbalancedGoods, unfarmedFieldGoods, uncatalogedBuildings } = mergeRealContent(rawRealLike());
    expect(unbalancedGoods).toContain('testberry');
    expect(unbalancedGoods).not.toContain('wood'); // wood has a clean-room balance
    expect(unfarmedFieldGoods).toContain('testherb');
    expect(unfarmedFieldGoods).not.toContain('wheat'); // wheat got its clean-room farming block
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

  it('sets the clean-room settler HP on a playable tribe that ships without one, never on an animal tribe', () => {
    // Real ir.json ships human tribes with no `hitpoints`; the overlay fills each PLAYABLE tribe (one with a
    // `jobEnables` tech-graph) and leaves an animal/monster tribe (none) at its own pool.
    const base = rawRealLike();
    const zeroed = base.tribes.map((t) => ({ ...t, hitpoints: 0 })); // all sandbox tribes are playable
    const firstTribe = base.tribes[0];
    if (firstTribe === undefined) throw new Error('fixture: no tribes');
    const animal = {
      ...firstTribe,
      typeId: OUT_OF_CATALOG_TYPE_ID + 5,
      id: 'beast_test',
      hitpoints: 0,
      jobEnables: [],
    };
    const raw = parseContentSet({ ...base, tribes: [...zeroed, animal] });

    const { content } = mergeRealContent(raw);
    for (const t of zeroed) {
      expect(content.tribes.find((x) => x.typeId === t.typeId)?.hitpoints).toBe(HUMAN_HITPOINTS);
    }
    expect(content.tribes.find((t) => t.typeId === animal.typeId)?.hitpoints).toBe(0);
  });

  it('localizes good display names from the goodNames map, leaving unlisted goods as-is', () => {
    const raw = rawRealLike();
    const { content } = mergeRealContent(raw, new Map([['wood', 'Drewno']]));
    expect(goodById(content, 'wood').name).toBe('Drewno');
    // A good absent from the map keeps whatever name it shipped with (unchanged).
    expect(goodById(content, 'coin').name).toBe(goodById(raw, 'coin').name);
  });
});

/** A Response-shaped stub for the injected fetch — only `ok` + `json()` are read (see net.ts). */
function fetchStub(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('loadRuntimeRealContent', () => {
  it('fetches + merges the served content (nav classes injected), or null when absent', async () => {
    // A plain-JSON round-trip of the stand-in, like the served ir.json the loader parses.
    const served = JSON.parse(JSON.stringify(rawRealLike()));
    const merge = await loadRuntimeRealContent(new Map([['wood', 'Drewno']]), fetchStub(served));
    expect(merge).not.toBeNull();
    expect(merge?.content.landscape.some((t) => t.typeId === TERRAIN_OPEN)).toBe(true);
    expect(goodById(merge?.content ?? sandboxContent(), 'wood').name).toBe('Drewno');
    expect(merge?.unbalancedGoods).toContain('testberry');

    // A bare checkout (no ir.json → 404) degrades to null so the entries fall back to sandbox content.
    expect(await loadRuntimeRealContent(undefined, fetchStub(null, false))).toBeNull();
  });
});

describe('logRealContentGaps', () => {
  it('logs one line when there are gaps, and is silent otherwise', () => {
    // Asserted on the logger's own ring, not its console echo (the app suite silences that echo).
    const before = diag.entries().length;
    const content = sandboxContent();
    logRealContentGaps({
      content,
      unbalancedGoods: ['testberry'],
      unfarmedFieldGoods: ['herb'],
      uncatalogedBuildings: ['wonder'],
    });
    const logged = diag.entries().slice(before);
    expect(logged).toHaveLength(1);
    const line = logged[0]?.message ?? '';
    expect(line).toContain('testberry'); // names the uncalibrated gathered good
    expect(line).toContain('herb'); // names the unfarmed field good
    expect(line).toContain('wonder'); // names the uncataloged building
    logRealContentGaps({ content, unbalancedGoods: [], unfarmedFieldGoods: [], uncatalogedBuildings: [] });
    expect(diag.entries()).toHaveLength(before + 1);
  });
});

describe('nav-terrain flat colours', () => {
  it('re-banded class ids still render as their base index colour', () => {
    // The reband keeps TERRAIN_CLASS_BASE a multiple of the render TILE_COLOURS length, so a class id
    // indexes back to its own flat colour — the cross-package coupling only two comments guard otherwise.
    NAV_LANDSCAPE_TYPES.forEach((t, k) => {
      expect(flatTileColour(t.typeId)).toBe(flatTileColour(k));
    });
  });
});
