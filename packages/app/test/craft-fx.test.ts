import { describe, expect, it } from 'vitest';
import {
  buildCraftFxBinding,
  craftFxAtlasStems,
  resolveCraftFxRefs,
} from '../src/content/building-gfx/craft-fx.js';
import { HOLY_FIRE_EFFECT_NAME, holyFireLookup } from '../src/content/ir/joins.js';
import type { ContentIr } from '../src/content/ir/rows.js';

/**
 * The staged-effect join: the `gfxinhouseoverlaylandscape` names of the in-house programs resolve to
 * their `[GfxLandscape]` records' served atlas and loop, and bind only for the families that loaded.
 */

const VIKING = 1;
const DRUID = 30;
const SMITH = 13;
const HQ = 1;
const TEMPLE = 37;
/** A tower with fire points and no prayer site; the source gives them to another tribe's tower. */
const TOWER = 41;

function fixtureIr(): ContentIr {
  return {
    landscapeGfx: [
      {
        index: 651,
        editName: 'fx fire incense',
        logicType: 1,
        bmd: 'data/engine2d/bin/bobs/ls_smoke.bmd',
        paletteName: 'fire_incense',
        frames: [{ state: 1, bobIds: [66, 67, 68] }],
      },
      {
        index: 649,
        editName: 'fx smoke',
        logicType: 1,
        bmd: 'data/engine2d/bin/bobs/ls_smoke.bmd',
        paletteName: 'smoke',
        frames: [{ state: 1, bobIds: [0, 1, 2] }],
      },
      {
        index: 653,
        editName: 'fx fire small',
        logicType: 1,
        bmd: 'data/engine2d/bin/bobs/ls_smoke.bmd',
        paletteName: 'fire',
        frames: [{ state: 1, bobIds: [172, 173] }],
      },
      // Names no atlas: stages nothing rather than a wrong family.
      { index: 700, editName: 'fx bare', logicType: 1, frames: [{ state: 1, bobIds: [5] }] },
    ],
    buildingHolyFirePoints: [
      { tribeId: VIKING, typeId: 4, level: 2, x: -80, y: 24 },
      { tribeId: VIKING, typeId: 5, level: 3, x: -79, y: 25 },
      { tribeId: VIKING, typeId: 5, level: 3, x: -3, y: 45 },
      { tribeId: VIKING, typeId: HQ, level: 0, x: 17, y: 38 },
      { tribeId: VIKING, typeId: TEMPLE, level: 0, x: 5, y: 20 },
      { tribeId: VIKING, typeId: TOWER, level: 1, x: 3, y: 9 },
    ],
    buildings: [
      { typeId: 4, id: 'home_level_02', kind: 'home' },
      { typeId: HQ, id: 'headquarters', kind: 'storage', prayerSite: 'headquarters' },
      { typeId: TEMPLE, id: 'work_temple', kind: 'workplace', prayerSite: 'temple' },
      { typeId: TOWER, id: 'tower_01', kind: 'tower' },
    ],
    gfxInHousePrograms: [
      {
        tribe: VIKING,
        job: DRUID,
        action: 71,
        entries: [
          { kind: 'landscape', name: 'fx fire small', x: 69, y: 66, from: 10, to: 90 },
          { kind: 'landscape', name: 'fx smoke', x: 72, y: 30, from: 10, to: 95 },
          { kind: 'walk', dir: 7, goodType: 14, x: -30, y: 38, from: 0, to: 0 },
        ],
      },
      {
        tribe: VIKING,
        job: SMITH,
        action: 60,
        entries: [
          { kind: 'landscape', name: 'fx fire small', x: -61, y: -2, from: 12, to: 28 },
          { kind: 'landscape', name: 'fx bare', x: 0, y: 0, from: 0, to: 100 },
          { kind: 'landscape', name: 'fx unknown', x: 0, y: 0, from: 0, to: 100 },
          { kind: 'houseBob', layer: 4, x: 0, y: 0, from: 0, to: 15 },
        ],
      },
    ],
  };
}

describe('the staged craft effects', () => {
  it('resolves each distinct staged name once to its record’s family and loop', () => {
    const refs = resolveCraftFxRefs(fixtureIr());
    expect(refs).toEqual([
      { name: 'fx fire small', loop: { layer: 'ls_smoke.fire', frames: [172, 173] } },
      { name: 'fx smoke', loop: { layer: 'ls_smoke.smoke', frames: [0, 1, 2] } },
    ]);
    expect([...craftFxAtlasStems(refs)].sort()).toEqual(['ls_smoke.fire', 'ls_smoke.smoke']);
    expect(resolveCraftFxRefs(null)).toEqual([]);
  });

  it('binds only the effects whose family loaded, and nothing when none did', () => {
    const refs = resolveCraftFxRefs(fixtureIr());
    const binding = buildCraftFxBinding(refs, new Set(['ls_smoke.smoke']));
    expect(binding).toEqual({ byName: { 'fx smoke': { layer: 'ls_smoke.smoke', frames: [0, 1, 2] } } });
    expect(buildCraftFxBinding(refs, new Set())).toBeUndefined();
  });

  it('loads the engine-pinned incense loop and preserves every authored home anchor', () => {
    expect(resolveCraftFxRefs(fixtureIr(), [HOLY_FIRE_EFFECT_NAME])).toContainEqual({
      name: HOLY_FIRE_EFFECT_NAME,
      loop: { layer: 'ls_smoke.fire_incense', frames: [66, 67, 68] },
    });
    const lookup = holyFireLookup(fixtureIr());
    expect(lookup(VIKING, 4, 2)).toEqual({
      name: HOLY_FIRE_EFFECT_NAME,
      points: [{ x: -80, y: 24 }],
      perpetual: false,
    });
    expect(lookup(VIKING, 5, 3)?.points).toEqual([
      { x: -79, y: 25 },
      { x: -3, y: 45 },
    ]);
    expect(lookup(VIKING, 3, 1)).toBeUndefined();
  });

  it('keeps the fire of a prayer site burning without oil, and only there', () => {
    const lookup = holyFireLookup(fixtureIr());
    expect(lookup(VIKING, TEMPLE, 0)?.perpetual).toBe(true);
    expect(lookup(VIKING, HQ, 0)?.perpetual).toBe(true);
    expect(lookup(VIKING, 4, 2)?.perpetual).toBe(false);
    expect(lookup(VIKING, TOWER, 1)?.perpetual).toBe(false);
  });
});
