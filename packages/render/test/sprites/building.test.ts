import { describe, expect, it } from 'vitest';
import {
  type BuildingTypeBinding,
  bobKey,
  finishedBuildingBobKeys,
  resolveBuildingDraw,
  resolveBuildingOverlayDraw,
  resolveConstructionDraws,
  resolveSpriteBobId,
} from '../../src/data/sprites/index.js';
import type { DrawItem, SpriteBindings } from '../../src/index.js';
import { drawItem } from '../support/fixtures.js';

/**
 * Unit tests for the building frame-selection resolvers — the per-type house bob, layer-qualified
 * (multi-.bmd) bindings, the construction-stage stack, the animated state overlay (the mill rotor),
 * and the finished-sprite set the construction rise excludes.
 */

describe('resolveSpriteBobId — per-type building binding', () => {
  /** A building draw item, optionally carrying its `buildingType` (the `Building.buildingType` typeId). */
  function building(typeId?: number): DrawItem {
    return drawItem('building', typeId !== undefined ? { typeId } : {});
  }
  // home=41, well=131, farm=60 (a subset of VIKING_HOUSE01_BOBS); an unmapped type falls back to 11.
  const bindings: SpriteBindings = {
    settler: 10,
    building: { byType: { 6: 41, 10: 131, 12: 60 }, default: 11 },
    resource: 30,
  };

  it('draws each building type its own bob (the LogicType -> GfxBobId join)', () => {
    expect(resolveSpriteBobId(building(6), bindings)).toBe(41); // viking home
    expect(resolveSpriteBobId(building(10), bindings)).toBe(131); // viking well
    expect(resolveSpriteBobId(building(12), bindings)).toBe(60); // viking farm
  });

  it('falls back to the default house for an unmapped type id', () => {
    expect(resolveSpriteBobId(building(999), bindings)).toBe(11);
  });

  it('falls back to the default house when the item carries no type id', () => {
    expect(resolveSpriteBobId(building(), bindings)).toBe(11);
  });

  it('a plain-number building binding draws the same frame for every type (back-compat)', () => {
    const flat: SpriteBindings = { settler: 10, building: 20, resource: 30 };
    expect(resolveSpriteBobId(building(6), flat)).toBe(20);
    expect(resolveSpriteBobId(building(), flat)).toBe(20);
  });
});

describe('resolveBuildingDraw — layer-qualified (multi-.bmd) building binding', () => {
  /** A building draw item, optionally carrying its `buildingType` (the `Building.buildingType` typeId). */
  function building(typeId?: number): DrawItem {
    return drawItem('building', typeId !== undefined ? { typeId } : {});
  }
  // typeId 10 = a plain bob (default layer); typeId 1 = the viking HQ in its own family (viking4 bob 34).
  const binding: BuildingTypeBinding = {
    byType: { 10: 131, 1: { layer: 'viking4', bob: 34 } },
    default: 11,
  };

  it('an unqualified bob ref resolves to no layer (the default building layer)', () => {
    expect(resolveBuildingDraw(binding, building(10))).toEqual({ bob: 131 });
  });

  it('a layer-qualified ref carries both its bob and its family layer', () => {
    expect(resolveBuildingDraw(binding, building(1))).toEqual({ bob: 34, layer: 'viking4' });
  });

  it('falls back to the (plain) default for an unmapped type id and a missing type id', () => {
    expect(resolveBuildingDraw(binding, building(999))).toEqual({ bob: 11 });
    expect(resolveBuildingDraw(binding, building())).toEqual({ bob: 11 });
  });

  it('honours a layer-qualified default for an unmapped type', () => {
    const qualifiedDefault: BuildingTypeBinding = {
      byType: { 10: 131 },
      default: { layer: 'viking4', bob: 44 },
    };
    expect(resolveBuildingDraw(qualifiedDefault, building(999))).toEqual({ bob: 44, layer: 'viking4' });
  });

  it('a plain-number binding resolves to that bob with no layer (back-compat)', () => {
    expect(resolveBuildingDraw(20, building(6))).toEqual({ bob: 20 });
    expect(resolveBuildingDraw(20, building())).toEqual({ bob: 20 });
  });

  it('agrees with resolveSpriteBobId on the bob id (the bob is the resolver split-out)', () => {
    expect(resolveBuildingDraw(binding, building(1)).bob).toBe(
      resolveSpriteBobId(building(1), { settler: 10, building: binding, resource: 30 }),
    );
  });
});

describe('resolveConstructionDraws — construction-stage stack for an under-construction building', () => {
  /** A building draw item at a given construction progress percent (omit = finished). */
  function site(typeId: number, builtPct?: number): DrawItem {
    return drawItem('building', { typeId, ...(builtPct !== undefined ? { builtPct } : {}) });
  }
  // The viking-home shape: foundation 0-50, scaffold 10-70, body 20-100 (stacking = list order); the
  // body stage is layer-qualified to show a family stage resolves like a family body.
  const binding: BuildingTypeBinding = {
    byType: { 2: 1 },
    default: 11,
    constructionByType: {
      2: [
        { bob: 102, fromPct: 0, toPct: 50 },
        { bob: 103, fromPct: 10, toPct: 70 },
        { bob: 101, layer: 'viking4', fromPct: 20, toPct: 100 },
      ],
    },
  };

  it('shows only the grey foundation at 0% and the full overlap mid-build, in stacking order', () => {
    expect(resolveConstructionDraws(binding, site(2, 0))).toEqual([{ bob: 102 }]);
    expect(resolveConstructionDraws(binding, site(2, 30))).toEqual([
      { bob: 102 },
      { bob: 103 },
      { bob: 101, layer: 'viking4' },
    ]);
    expect(resolveConstructionDraws(binding, site(2, 99))).toEqual([{ bob: 101, layer: 'viking4' }]);
  });

  it('returns null for a finished building, an unmapped type, and a table-less/plain binding', () => {
    expect(resolveConstructionDraws(binding, site(2))).toBeNull(); // no builtPct — finished
    expect(resolveConstructionDraws(binding, site(999, 30))).toBeNull(); // type has no stage table
    expect(resolveConstructionDraws({ byType: {}, default: 11 }, site(2, 30))).toBeNull();
    expect(resolveConstructionDraws(20, site(2, 30))).toBeNull(); // plain-number binding
  });

  it('floors an out-of-range progress on the first stage so a site never draws as nothing', () => {
    const gappy: BuildingTypeBinding = {
      byType: {},
      default: 11,
      constructionByType: { 2: [{ bob: 102, fromPct: 10, toPct: 50 }] },
    };
    expect(resolveConstructionDraws(gappy, site(2, 0))).toEqual([{ bob: 102 }]); // below every range
  });
});

describe('resolveBuildingOverlayDraw — the animated state overlay (the mill rotor)', () => {
  /** A mill draw item: finished by default; `working` = mid production cycle. */
  function mill(opts: { working?: boolean; builtPct?: number; typeId?: number } = {}): DrawItem {
    return drawItem('building', {
      typeId: opts.typeId ?? 13,
      ...(opts.working !== undefined ? { working: opts.working } : {}),
      ...(opts.builtPct !== undefined ? { builtPct: opts.builtPct } : {}),
    });
  }
  // The viking mill shape: bladeless body 70, still blade 76, a 3-frame spin cycle at 2 ticks/frame,
  // all in the `miller` family layer.
  const binding: BuildingTypeBinding = {
    byType: { 13: { layer: 'miller', bob: 70 } },
    default: 11,
    overlayByType: { 13: { layer: 'miller', idle: 76, working: [85, 84, 83], ticksPerFrame: 2 } },
  };

  it('draws the still idle blade while the mill is not producing (any tick)', () => {
    expect(resolveBuildingOverlayDraw(binding, mill(), 0)).toEqual({ bob: 76, layer: 'miller' });
    expect(resolveBuildingOverlayDraw(binding, mill(), 999)).toEqual({ bob: 76, layer: 'miller' });
  });

  it('cycles the spin frames on the free tick clock while producing, at ticksPerFrame cadence', () => {
    const at = (tick: number): number | undefined =>
      resolveBuildingOverlayDraw(binding, mill({ working: true }), tick)?.bob;
    // 2 ticks per frame: 85 85 84 84 83 83, then wrap.
    expect([at(0), at(1), at(2), at(3), at(4), at(5), at(6)]).toEqual([85, 85, 84, 84, 83, 83, 85]);
  });

  it('draws no overlay under construction, for an overlay-less type, and for a plain binding', () => {
    expect(resolveBuildingOverlayDraw(binding, mill({ builtPct: 50 }), 0)).toBeNull();
    expect(resolveBuildingOverlayDraw(binding, mill({ typeId: 2 }), 0)).toBeNull();
    expect(resolveBuildingOverlayDraw(20, mill(), 0)).toBeNull();
  });

  it('falls back per state: a working mill with no spin frames holds the idle blade; a stateless entry draws nothing', () => {
    const idleOnly: BuildingTypeBinding = {
      byType: {},
      default: 11,
      overlayByType: { 13: { idle: 76 } },
    };
    expect(resolveBuildingOverlayDraw(idleOnly, mill({ working: true }), 5)).toEqual({ bob: 76 });
    const empty: BuildingTypeBinding = { byType: {}, default: 11, overlayByType: { 13: {} } };
    expect(resolveBuildingOverlayDraw(empty, mill(), 0)).toBeNull();
  });
});

describe('finishedBuildingBobKeys — the finished-sprite set excluded from the construction rise', () => {
  it('keys every type bob + the default (bare and layer-qualified), so only scaffold stages survive', () => {
    // Two finished homes (a bare default + a layer-qualified tier) plus construction-only scaffold bobs.
    const binding: BuildingTypeBinding = {
      byType: { 2: 1, 3: { layer: 'viking4', bob: 11 } },
      default: 99,
      constructionByType: {
        2: [{ bob: 2 }, { bob: 3 }, { bob: 1 }].map((l) => ({ ...l, fromPct: 0, toPct: 100 })),
      },
    };
    const finished = finishedBuildingBobKeys(binding);
    // Every FINISHED bob is present (the type-2 body, the layer-qualified type-3 body, the default).
    expect(finished.has(bobKey({ bob: 1 }))).toBe(true);
    expect(finished.has(bobKey({ bob: 11, layer: 'viking4' }))).toBe(true);
    expect(finished.has(bobKey({ bob: 99 }))).toBe(true);
    // The construction-only scaffold bobs are NOT finished sprites — they rise.
    expect(finished.has(bobKey({ bob: 2 }))).toBe(false);
    expect(finished.has(bobKey({ bob: 3 }))).toBe(false);
    // Filtering the stage stack by this set drops the finished body (bob 1), keeps the scaffold (2, 3).
    const midBuild = drawItem('building', { typeId: 2, builtPct: 40 });
    const scaffold = (resolveConstructionDraws(binding, midBuild) ?? []).filter(
      (d) => !finished.has(bobKey(d)),
    );
    expect(scaffold).toEqual([{ bob: 2 }, { bob: 3 }]);
  });

  it('memoizes per binding — the same set instance is returned across calls', () => {
    const binding: BuildingTypeBinding = { byType: { 2: 1 }, default: 11 };
    expect(finishedBuildingBobKeys(binding)).toBe(finishedBuildingBobKeys(binding));
  });
});
