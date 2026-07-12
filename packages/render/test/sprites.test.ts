import { describe, expect, it } from 'vitest';
import type { DrawItem, SpriteState } from '../src/index.js';
import {
  type AtlasManifest,
  atlasFromManifest,
  type BuildingTypeBinding,
  type ByJobTable,
  bobKey,
  DEFAULT_FACING,
  type DirectionalAnim,
  type FrameListAnim,
  finishedBuildingBobKeys,
  indexAtlasFrames,
  pickByJob,
  resolveBuildingDraw,
  resolveConstructionDraws,
  resolveResourceDraw,
  resolveSpriteBobId,
  resolveSpriteFrame,
  resolveStockpileDraw,
  resolveStockpileLayerDraws,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
} from '../src/index.js';

/**
 * Unit tests for the PURE half of the atlas-sprite swap — which atlas frame a draw item resolves to.
 * This is the self-verifiable part (a data lookup); binding the rect to a GPU texture + sampling its
 * pixels stays on the Pixi side, deferred to a human. No Pixi, no canvas here.
 */

/** Hand-build a minimal draw item (the fields the resolver reads). */
function item(kind: DrawItem['kind']): DrawItem {
  return { kind, ref: 1, x: 0, y: 0, depth: 0 };
}

/** A tiny atlas: a settler frame (bob 10), a building frame (bob 20), and an empty 0×0 bob (30). */
function atlas(): SpriteAtlas {
  return indexAtlasFrames(64, 64, [
    { bobId: 10, rect: { x: 0, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
    { bobId: 20, rect: { x: 16, y: 0, width: 28, height: 40 }, offsetX: -14, offsetY: -40 },
    { bobId: 30, rect: { x: 0, y: 0, width: 0, height: 0 }, offsetX: 0, offsetY: 0 },
  ]);
}

const BINDINGS: SpriteBindings = { settler: 10, building: 20, resource: 30 };

describe('indexAtlasFrames', () => {
  it('indexes manifest frames by bob id, carrying rect + draw offset', () => {
    const a = atlas();
    expect(a.width).toBe(64);
    expect(a.height).toBe(64);
    expect(a.frames.get(10)).toEqual({ x: 0, y: 0, width: 12, height: 24, offsetX: -6, offsetY: -24 });
    expect(a.frames.get(20)?.width).toBe(28);
    expect(a.frames.has(30)).toBe(true); // the empty bob is still indexed (id-addressable)
  });
});

describe('resolveSpriteFrame', () => {
  it('resolves a bound kind to its atlas frame', () => {
    const frame = resolveSpriteFrame(item('settler'), BINDINGS, atlas());
    expect(frame).toEqual({ x: 0, y: 0, width: 12, height: 24, offsetX: -6, offsetY: -24 });
  });

  it('returns null for a terrain tile (tiles bind by typeId, not these bindings)', () => {
    expect(resolveSpriteFrame(item('tile'), BINDINGS, atlas())).toBeNull();
  });

  it('returns null when the kind has no binding (-> placeholder geometry)', () => {
    const partial = { settler: 10 } as SpriteBindings; // building/resource unbound
    expect(resolveSpriteFrame(item('building'), partial, atlas())).toBeNull();
  });

  it('returns null when the bound bob id is absent from the atlas', () => {
    const missing: SpriteBindings = { settler: 999, building: 20, resource: 30 };
    expect(resolveSpriteFrame(item('settler'), missing, atlas())).toBeNull();
  });

  it('returns null for a 0×0 (empty) bound frame, so the placeholder still draws', () => {
    // resource -> bob 30, which is the 0×0 empty bob.
    expect(resolveSpriteFrame(item('resource'), BINDINGS, atlas())).toBeNull();
  });

  it('resolves a resource to its own (tree) atlas frame — the ls_trees per-kind bind', () => {
    // Mirrors the real resource bind: resource -> a non-empty bob in its OWN atlas (the per-kind tree
    // layer the GPU blits from). Geometry like ls_trees frame 60: a 101×111 tree anchored at its base.
    const treeAtlas = indexAtlasFrames(1024, 4914, [
      { bobId: 60, rect: { x: 1, y: 1, width: 101, height: 111 }, offsetX: -54, offsetY: -100 },
    ]);
    const bindings: SpriteBindings = { settler: 10, building: 20, resource: 60 };
    expect(resolveSpriteFrame(item('resource'), bindings, treeAtlas)).toEqual({
      x: 1,
      y: 1,
      width: 101,
      height: 111,
      offsetX: -54,
      offsetY: -100,
    });
  });

  it('is pure: the same item + tables always resolve to the same frame', () => {
    const a = atlas();
    const first = resolveSpriteFrame(item('building'), BINDINGS, a);
    const second = resolveSpriteFrame(item('building'), BINDINGS, a);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('resolveSpriteFrame — per-state settler binding', () => {
  /** A settler draw item in a given state (+ optional atomic id). */
  function settler(state?: SpriteState, atomicId?: number): DrawItem {
    return {
      kind: 'settler',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      ...(state !== undefined ? { state } : {}),
      ...(atomicId !== undefined ? { atomicId } : {}),
    };
  }

  /** An atlas with a distinct frame per state bob: idle=10, moving=11, acting=12, chop=13. */
  function stateAtlas(): SpriteAtlas {
    return indexAtlasFrames(64, 64, [
      { bobId: 10, rect: { x: 0, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
      { bobId: 11, rect: { x: 16, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
      { bobId: 12, rect: { x: 32, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
      { bobId: 13, rect: { x: 48, y: 0, width: 12, height: 24 }, offsetX: -6, offsetY: -24 },
    ]);
  }

  const FULL: SettlerStateBinding = {
    idle: 10,
    moving: 11,
    acting: 12,
    byAtomic: { 24: 13 }, // atomic 24 (chop) overrides the generic acting frame
  };
  const bindings = (settlerBinding: SpriteBindings['settler']): SpriteBindings => ({
    settler: settlerBinding,
    building: 20,
    resource: 30,
  });

  it('picks the state-specific frame: idle/moving/acting each resolve to their own bob', () => {
    const atlas = stateAtlas();
    const b = bindings(FULL);
    expect(resolveSpriteFrame(settler('idle'), b, atlas)?.x).toBe(0); // bob 10
    expect(resolveSpriteFrame(settler('moving'), b, atlas)?.x).toBe(16); // bob 11
    expect(resolveSpriteFrame(settler('acting'), b, atlas)?.x).toBe(32); // bob 12
  });

  it('picks the per-atomic override for an acting settler with a bound atomic id', () => {
    const frame = resolveSpriteFrame(settler('acting', 24), bindings(FULL), stateAtlas());
    expect(frame?.x).toBe(48); // bob 13 — the chop override, not the generic acting bob 12
  });

  it('falls back acting->idle and moving->idle when those states are unbound', () => {
    const sparse: SettlerStateBinding = { idle: 10 }; // no moving/acting/byAtomic
    const b = bindings(sparse);
    const atlas = stateAtlas();
    expect(resolveSpriteFrame(settler('moving'), b, atlas)?.x).toBe(0); // -> idle bob 10
    expect(resolveSpriteFrame(settler('acting'), b, atlas)?.x).toBe(0); // -> idle bob 10
    expect(resolveSpriteFrame(settler('acting', 24), b, atlas)?.x).toBe(0); // unlisted atomic -> idle
  });

  it('falls back an unlisted atomic to the generic acting frame', () => {
    const frame = resolveSpriteFrame(settler('acting', 99), bindings(FULL), stateAtlas());
    expect(frame?.x).toBe(32); // bob 12 — generic acting, since atomic 99 isn't in byAtomic
  });

  it('treats a stateless settler item as idle (back-compat with the flat scene)', () => {
    const frame = resolveSpriteFrame(settler(), bindings(FULL), stateAtlas());
    expect(frame?.x).toBe(0); // bob 10 — no state field -> idle
  });

  it('a plain-number settler binding draws the same frame for every state (back-compat)', () => {
    const b = bindings(10); // a bare bob id, the old binding shape
    const atlas = stateAtlas();
    expect(resolveSpriteFrame(settler('idle'), b, atlas)?.x).toBe(0);
    expect(resolveSpriteFrame(settler('moving'), b, atlas)?.x).toBe(0);
    expect(resolveSpriteFrame(settler('acting', 24), b, atlas)?.x).toBe(0);
  });
});

describe('resolveSpriteBobId — per-type building binding', () => {
  /** A building draw item, optionally carrying its `buildingType` (the `Building.buildingType` typeId). */
  function building(typeId?: number): DrawItem {
    return { kind: 'building', ref: 1, x: 0, y: 0, depth: 0, ...(typeId !== undefined ? { typeId } : {}) };
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
    return { kind: 'building', ref: 1, x: 0, y: 0, depth: 0, ...(typeId !== undefined ? { typeId } : {}) };
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
    return {
      kind: 'building',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      typeId,
      ...(builtPct !== undefined ? { builtPct } : {}),
    };
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
    const midBuild: DrawItem = { kind: 'building', ref: 1, x: 0, y: 0, depth: 0, typeId: 2, builtPct: 40 };
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

describe('resolveSpriteBobId — directional animated binding', () => {
  /** A settler draw item with an explicit facing + the resolver's other inputs. */
  function settler(state: SpriteState, facing?: number, atomicId?: number, elapsed?: number): DrawItem {
    return {
      kind: 'settler',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      state,
      ...(facing !== undefined ? { facing } : {}),
      ...(atomicId !== undefined ? { atomicId } : {}),
      ...(elapsed !== undefined ? { elapsed } : {}),
    };
  }
  const WALK: DirectionalAnim = { start: 1988, dirs: 8, stride: 12 };
  const CHOP: DirectionalAnim = { start: 5106, dirs: 8, stride: 15 };
  const STAND: DirectionalAnim = { start: 1988, dirs: 8, stride: 12, frames: 1 };
  // No generic `acting`: CHOP is bound only to the harvest atomic (24), mirroring the real human
  // binding — an unmapped action (a deposit) must fall back to the idle pose, not the woodcut swing.
  const ANIM: SettlerStateBinding = { idle: STAND, moving: WALK, byAtomic: { 24: CHOP } };
  const bindings: SpriteBindings = { settler: ANIM, building: 20, resource: 30 };

  it('moving: start + facing*stride + tick%stride (the walk cycle for the heading)', () => {
    expect(resolveSpriteBobId(settler('moving', 3), bindings, 5)).toBe(1988 + 3 * 12 + 5);
    expect(resolveSpriteBobId(settler('moving', 0), bindings, 0)).toBe(1988);
  });

  it('wraps the cycle by tick % stride (frame 12 loops back to 0)', () => {
    expect(resolveSpriteBobId(settler('moving', 0), bindings, 12)).toBe(1988); // 12 % 12 == 0
    expect(resolveSpriteBobId(settler('moving', 0), bindings, 13)).toBe(1989);
  });

  it('acting chop (atomic 24) advances on its elapsed clock at a fixed cadence, ignoring tick', () => {
    // frame = start + facing*stride + ((elapsed-1) % cycle): driven by the atomic's OWN elapsed-tick
    // clock (frame 0 on its first tick), NOT the free tick clock — tick=999 must not change it.
    const swing = (elapsed: number): number | null =>
      resolveSpriteBobId(settler('acting', 4, 24, elapsed), bindings, 999);
    expect(swing(1)).toBe(5106 + 4 * 15 + 0); // first acting tick -> frame 0 (the swing's start)
    expect(swing(8)).toBe(5106 + 4 * 15 + 7); // seven ticks in -> frame 7, mid-swing
    expect(swing(15)).toBe(5106 + 4 * 15 + 14); // fifteenth tick -> frame 14, the swing's last frame
  });

  it('the chop cadence is the SAME regardless of how long the action runs (constant speed)', () => {
    // The phase is a pure function of elapsed alone — no duration input — so a swing always advances one
    // frame per tick. (The pre-fix bug stretched the swing across each atomic's duration, so a short
    // action replayed the whole swing faster; that is structurally impossible now.)
    const frameAt = (elapsed: number): number | null =>
      resolveSpriteBobId(settler('acting', 0, 24, elapsed), bindings, 0);
    expect(frameAt(1)).toBe(5106 + 0); // frame 0
    expect(frameAt(2)).toBe(5106 + 1); // +1 tick == +1 frame, always
    expect(frameAt(16)).toBe(5106 + 0); // elapsed 16 -> (16-1) % 15 == 0: a longer action loops the cycle
  });

  it('phaseStart rotates the loop start so a chop plays windup (9..14) then strike (0..8)', () => {
    // The woodcut loop is 0..8 = strike-down, 9..14 = windup-rise. phaseStart 9 begins on the windup:
    // frame = (9 + (elapsed-1)) % 15, so elapsed 1 -> 9 (windup start), elapsed 15 -> 8 (impact, the end).
    const SWING: DirectionalAnim = { start: 5106, dirs: 8, stride: 15, phaseStart: 9 };
    const b: SpriteBindings = { settler: { idle: STAND, byAtomic: { 24: SWING } }, building: 0, resource: 0 };
    const at = (elapsed: number): number | null =>
      resolveSpriteBobId(settler('acting', 4, 24, elapsed), b, 0);
    expect(at(1)).toBe(5106 + 4 * 15 + 9); // first tick -> frame 9 (windup begins, axe rising)
    expect(at(6)).toBe(5106 + 4 * 15 + 14); // -> frame 14 (top of the windup)
    expect(at(7)).toBe(5106 + 4 * 15 + 0); // wraps -> frame 0 (strike begins, axe coming down)
    expect(at(15)).toBe(5106 + 4 * 15 + 8); // -> frame 8 (impact, the strike lands — the final frame)
  });

  it('an acting atomic with no bound animation holds the idle pose (no borrowed swing)', () => {
    // Atomic 23 (a deposit) isn't in byAtomic and there is no generic `acting`, so it falls back to the
    // single-pose idle/STAND — never the woodcut swing replayed at the wrong speed.
    expect(resolveSpriteBobId(settler('acting', 2, 23, 3), bindings, 0)).toBe(1988 + 2 * 12);
  });

  it('idle holds a single planted pose per direction (frames: 1 ignores tick)', () => {
    expect(resolveSpriteBobId(settler('idle', 2), bindings, 99)).toBe(1988 + 2 * 12); // no phase advance
  });

  it('falls back to DEFAULT_FACING when the item carries no facing', () => {
    expect(resolveSpriteBobId(settler('moving'), bindings, 0)).toBe(1988 + DEFAULT_FACING * 12);
  });

  it('wraps an out-of-range / negative facing into 0..dirs', () => {
    expect(resolveSpriteBobId(settler('moving', 8), bindings, 0)).toBe(1988); // 8 % 8 == 0
    expect(resolveSpriteBobId(settler('moving', -1), bindings, 0)).toBe(1988 + 7 * 12); // -> dir 7
  });

  it('a plain-number frame ref still ignores facing + tick (back-compat)', () => {
    const flat: SpriteBindings = { settler: { idle: 1931 }, building: 20, resource: 30 };
    expect(resolveSpriteBobId(settler('idle', 5), flat, 42)).toBe(1931);
  });
});

describe('resolveSpriteBobId — FrameListAnim (explicit per-direction attack layout)', () => {
  function settler(state: SpriteState, facing?: number, atomicId?: number, elapsed?: number): DrawItem {
    return {
      kind: 'settler',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      state,
      ...(facing !== undefined ? { facing } : {}),
      ...(atomicId !== undefined ? { atomicId } : {}),
      ...(elapsed !== undefined ? { elapsed } : {}),
    };
  }
  const ATTACK = 81;
  const STAND: DirectionalAnim = { start: 100, dirs: 8, stride: 4, frames: 1 };
  // A swing pool at bob 2000 with DISTINCT per-facing lists (so facing must select the right list), and
  // an authored hold/repeat in dir 1 (frame 5 held) — the layout a uniform stride can't encode.
  const SWING: FrameListAnim = {
    start: 2000,
    frameLists: [
      [0, 2, 4, 6], // dir 0
      [5, 5, 7], // dir 1 — holds frame 5, then a 3-frame list (shorter than dir 0)
    ],
  };
  const ANIM: SettlerStateBinding = { idle: STAND, byAtomic: { [ATTACK]: SWING } };
  const bindings: SpriteBindings = { settler: ANIM, building: 20, resource: 30 };

  it('draws start + frameLists[facing][elapsed-1] — the facing selects the list, elapsed indexes it', () => {
    const at = (facing: number, elapsed: number): number | null =>
      resolveSpriteBobId(settler('acting', facing, ATTACK, elapsed), bindings, 999);
    expect(at(0, 1)).toBe(2000 + 0); // dir 0, frame 0 -> local 0
    expect(at(0, 3)).toBe(2000 + 4); // dir 0, frame 2 -> local 4
    expect(at(1, 1)).toBe(2000 + 5); // dir 1, frame 0 -> local 5 (the held windup)
    expect(at(1, 2)).toBe(2000 + 5); // dir 1, frame 1 -> local 5 again (the authored hold)
    expect(at(1, 3)).toBe(2000 + 7); // dir 1, frame 2 -> local 7
  });

  it('plays ONE-SHOT: past the CHOSEN list end the sprite shows the FIRST entry (the ready stance)', () => {
    // dir 1 is 3 long: elapsed 4 is one past the end — entry 0 (which a wrap ALSO gives; the cases
    // below are the ones where the two contracts diverge).
    expect(resolveSpriteBobId(settler('acting', 1, ATTACK, 4), bindings, 0)).toBe(2000 + 5);
    // dir 0 past its 4-entry end: entry 0 (local 0) — a wrap would give entry 1 (local 2) at elapsed 6
    // and cycle back through the motion (the reported mid-swing freeze/stutter class of bug).
    expect(resolveSpriteBobId(settler('acting', 0, ATTACK, 6), bindings, 0)).toBe(2000 + 0);
    expect(resolveSpriteBobId(settler('acting', 0, ATTACK, 60), bindings, 0)).toBe(2000 + 0);
  });

  it('runs on the atomic elapsed clock, not the free tick (a swing is duration-independent)', () => {
    expect(resolveSpriteBobId(settler('acting', 0, ATTACK, 2), bindings, 12345)).toBe(2000 + 2); // frame 1
  });

  it('wraps a facing beyond the list count into the available directions', () => {
    // Only 2 lists here; facing 3 wraps 3 % 2 == 1 -> dir 1's list.
    expect(resolveSpriteBobId(settler('acting', 3, ATTACK, 1), bindings, 0)).toBe(2000 + 5);
  });

  it('an empty facing list holds the pool start (never a crash / bogus id)', () => {
    const GAPPY: FrameListAnim = { start: 3000, frameLists: [[], [1, 2]] };
    const b: SpriteBindings = {
      settler: { idle: STAND, byAtomic: { [ATTACK]: GAPPY } },
      building: 0,
      resource: 0,
    };
    expect(resolveSpriteBobId(settler('acting', 0, ATTACK, 5), b, 0)).toBe(3000); // dir 0 is empty -> start
  });
});

describe('resolveSpriteBobId — engaged (aggressive) gait override', () => {
  function settler(state: SpriteState, engaged: boolean, facing = 0): DrawItem {
    return {
      kind: 'settler',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      state,
      facing,
      ...(engaged ? { engaged: true } : {}),
    };
  }
  const WALK: DirectionalAnim = { start: 1000, dirs: 8, stride: 12 };
  const STAND: DirectionalAnim = { start: 1000, dirs: 8, stride: 12, frames: 1 };
  const AGGR_WALK: DirectionalAnim = { start: 2000, dirs: 8, stride: 12 };
  const AGGR_WAIT: DirectionalAnim = { start: 3000, dirs: 1, stride: 20 };
  const ANIM: SettlerStateBinding = {
    idle: STAND,
    moving: WALK,
    engaged: { moving: AGGR_WALK, idle: AGGR_WAIT },
  };
  const bindings: SpriteBindings = { settler: ANIM, building: 20, resource: 30 };

  it('engaged moving plays the aggressive walk instead of the relaxed one', () => {
    expect(resolveSpriteBobId(settler('moving', true), bindings, 3)).toBe(2000 + 3); // AGGR_WALK
    expect(resolveSpriteBobId(settler('moving', false), bindings, 3)).toBe(1000 + 3); // relaxed WALK
  });

  it('engaged idle plays the aggressive ready stance (facing-locked strip)', () => {
    expect(resolveSpriteBobId(settler('idle', true), bindings, 5)).toBe(3000 + 5); // AGGR_WAIT (dirs 1)
    expect(resolveSpriteBobId(settler('idle', false), bindings, 5)).toBe(1000); // STAND (frames:1)
  });

  it('falls back to the relaxed gait when an engaged slot is unbound', () => {
    const partial: SpriteBindings = {
      settler: { idle: STAND, moving: WALK, engaged: { moving: AGGR_WALK } }, // no engaged idle
      building: 0,
      resource: 0,
    };
    expect(resolveSpriteBobId(settler('idle', true), partial, 5)).toBe(1000); // falls back to STAND
  });
});

describe('resolveSpriteBobId — carrying (loaded-gait) override', () => {
  /** A settler draw item, with the optional `carrying` haul flag the loaded gait keys off. */
  function settler(
    state: SpriteState,
    opts: { facing?: number; atomicId?: number; elapsed?: number; carrying?: boolean } = {},
  ): DrawItem {
    return {
      kind: 'settler',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      state,
      ...(opts.facing !== undefined ? { facing: opts.facing } : {}),
      ...(opts.atomicId !== undefined ? { atomicId: opts.atomicId } : {}),
      ...(opts.elapsed !== undefined ? { elapsed: opts.elapsed } : {}),
      ...(opts.carrying ? { carrying: true } : {}),
    };
  }
  const WALK: DirectionalAnim = { start: 1988, dirs: 8, stride: 12 };
  const STAND: DirectionalAnim = { start: 1988, dirs: 8, stride: 12, frames: 1 };
  const CHOP: DirectionalAnim = { start: 5106, dirs: 8, stride: 15, phaseStart: 9 };
  // Mirrors the real human binding: empty walk/stand, the chop on the harvest atomic, and the loaded
  // gait (`..._walk_wood`, bob 4580) on the `carrying` override.
  const WALK_WOOD: DirectionalAnim = { start: 4580, dirs: 8, stride: 12 };
  const STAND_WOOD: DirectionalAnim = { start: 4580, dirs: 8, stride: 12, frames: 1 };
  const ANIM: SettlerStateBinding = {
    idle: STAND,
    moving: WALK,
    byAtomic: { 24: CHOP },
    carrying: { idle: STAND_WOOD, moving: WALK_WOOD },
  };
  const bindings: SpriteBindings = { settler: ANIM, building: 20, resource: 30 };

  it('a carrying settler walks the loaded cycle (WALK_WOOD), not the empty walk', () => {
    expect(resolveSpriteBobId(settler('moving', { facing: 3, carrying: true }), bindings, 5)).toBe(
      4580 + 3 * 12 + 5,
    );
    // Without the haul flag the SAME item walks the empty cycle (no carry override applied).
    expect(resolveSpriteBobId(settler('moving', { facing: 3 }), bindings, 5)).toBe(1988 + 3 * 12 + 5);
  });

  it('a carrying settler stands the loaded pose when idle (STAND_WOOD, frames:1 ignores tick)', () => {
    expect(resolveSpriteBobId(settler('idle', { facing: 2, carrying: true }), bindings, 99)).toBe(
      4580 + 2 * 12,
    );
  });

  it('a carrying settler depositing (unbound atomic) holds the loaded stand, not the empty idle', () => {
    // Atomic 23 (deposit/pileup) has no bound swing; while hauling it falls back to the carry stand
    // (STAND_WOOD) so the settler keeps its load on screen until the wood is actually placed.
    expect(
      resolveSpriteBobId(
        settler('acting', { facing: 2, atomicId: 23, elapsed: 3, carrying: true }),
        bindings,
        0,
      ),
    ).toBe(4580 + 2 * 12);
  });

  it('a bound atomic still wins over the carry override (a settler harvests empty-handed)', () => {
    // The chop is bound on atomic 24; even if a (spurious) carry flag were present the harvest swing
    // must still play — carry only swaps the gait, never a bound action animation.
    expect(
      resolveSpriteBobId(
        settler('acting', { facing: 4, atomicId: 24, elapsed: 1, carrying: true }),
        bindings,
        0,
      ),
    ).toBe(
      5106 + 4 * 15 + 9, // phaseStart 9: windup begins
    );
  });

  it('a carry override falls back to the un-loaded slot when a loaded slot is absent', () => {
    // Only `carrying.moving` bound: a hauling idle settler falls through to the plain idle STAND.
    const partial: SpriteBindings = {
      settler: { idle: STAND, moving: WALK, carrying: { moving: WALK_WOOD } },
      building: 0,
      resource: 0,
    };
    expect(resolveSpriteBobId(settler('moving', { facing: 1, carrying: true }), partial, 2)).toBe(
      4580 + 1 * 12 + 2,
    );
    expect(resolveSpriteBobId(settler('idle', { facing: 1, carrying: true }), partial, 2)).toBe(
      1988 + 1 * 12,
    );
  });
});

describe('atlasFromManifest', () => {
  /** A decoded `.atlas.json` shape, including the `type`/`opaque` fields the renderer ignores. */
  const manifest: AtlasManifest = {
    width: 1024,
    height: 7693,
    frames: [
      { bobId: 0, rect: { x: 1, y: 1, width: 20, height: 33 }, offsetX: -11, offsetY: -27 },
      { bobId: 1931, rect: { x: 517, y: 3063, width: 25, height: 35 }, offsetX: -12, offsetY: -27 },
    ],
  };

  it('adapts the on-disk manifest into a frame-indexed SpriteAtlas', () => {
    const atlas = atlasFromManifest(manifest);
    expect(atlas.width).toBe(1024);
    expect(atlas.height).toBe(7693);
    // Frames are keyed by bobId, carrying the rect + draw offset; a non-contiguous id resolves.
    const idle = atlas.frames.get(1931);
    expect(idle).toEqual({ x: 517, y: 3063, width: 25, height: 35, offsetX: -12, offsetY: -27 });
    expect(atlas.frames.get(0)?.width).toBe(20);
    expect(atlas.frames.has(999)).toBe(false);
  });

  it('equals the indexAtlasFrames it wraps (same width/height/frames)', () => {
    const direct = indexAtlasFrames(manifest.width, manifest.height, manifest.frames);
    const wrapped = atlasFromManifest(manifest);
    expect(wrapped.width).toBe(direct.width);
    expect(wrapped.height).toBe(direct.height);
    expect([...wrapped.frames]).toEqual([...direct.frames]);
  });
});

describe('resolveSpriteBobId — per-good carry look (carrying.byGood)', () => {
  /** A hauling settler item carrying a specific good (or none — the generic loaded look). */
  function hauler(state: SpriteState, facing: number, carryGood?: number): DrawItem {
    return {
      kind: 'settler',
      ref: 1,
      x: 0,
      y: 0,
      depth: 0,
      state,
      facing,
      carrying: true,
      ...(carryGood !== undefined ? { carryGood } : {}),
    };
  }
  const WALK: DirectionalAnim = { start: 1988, dirs: 8, stride: 12 };
  const WALK_WOOD: DirectionalAnim = { start: 4580, dirs: 8, stride: 12 };
  const WALK_STONE: DirectionalAnim = { start: 4100, dirs: 8, stride: 12 };
  const STAND_STONE: DirectionalAnim = { start: 4100, dirs: 8, stride: 12, frames: 1 };
  const STONE = 3;
  const bindings: SpriteBindings = {
    settler: {
      idle: { ...WALK, frames: 1 },
      moving: WALK,
      carrying: {
        idle: { ...WALK_WOOD, frames: 1 },
        moving: WALK_WOOD,
        byGood: { [STONE]: { idle: STAND_STONE, moving: WALK_STONE } },
      },
    },
    building: 20,
    resource: 30,
  };

  it('a settler hauling a byGood-bound good walks THAT cycle, not the generic loaded one', () => {
    expect(resolveSpriteBobId(hauler('moving', 3, STONE), bindings, 5)).toBe(4100 + 3 * 12 + 5);
  });

  it('a settler hauling an unbound good falls back to the generic loaded cycle', () => {
    expect(resolveSpriteBobId(hauler('moving', 3, 99), bindings, 5)).toBe(4580 + 3 * 12 + 5);
  });

  it('a settler hauling with NO carryGood on the item uses the generic loaded cycle', () => {
    expect(resolveSpriteBobId(hauler('moving', 3), bindings, 5)).toBe(4580 + 3 * 12 + 5);
  });

  it('the per-good stand backs the idle/deposit states too', () => {
    expect(resolveSpriteBobId(hauler('idle', 2, STONE), bindings, 99)).toBe(4100 + 2 * 12);
  });

  it('a byGood slot missing one state falls back to the generic loaded slot for that state', () => {
    const partial: SpriteBindings = {
      settler: {
        idle: { ...WALK, frames: 1 },
        moving: WALK,
        carrying: {
          idle: { ...WALK_WOOD, frames: 1 },
          moving: WALK_WOOD,
          byGood: { [STONE]: { moving: WALK_STONE } }, // no per-good idle
        },
      },
      building: 20,
      resource: 30,
    };
    expect(resolveSpriteBobId(hauler('idle', 2, STONE), partial, 0)).toBe(4580 + 2 * 12);
    expect(resolveSpriteBobId(hauler('moving', 2, STONE), partial, 0)).toBe(4100 + 2 * 12);
  });
});

describe('pickByJob — the per-job character pick', () => {
  const table: ByJobTable<string> = {
    byJob: { 5: 'woman', 31: 'warrior' },
    youngByJob: { 1: 'baby', 3: 'girl' },
    default: 'civilian',
  };

  it('an adult job picks from byJob; a miss (any trade) falls to the default', () => {
    expect(pickByJob(table, 5, false)).toBe('woman');
    expect(pickByJob(table, 31, false)).toBe('warrior');
    expect(pickByJob(table, 11, false)).toBe('civilian');
  });

  it('a young settler picks from youngByJob — never the adult table', () => {
    expect(pickByJob(table, 1, true)).toBe('baby');
    expect(pickByJob(table, 3, true)).toBe('girl');
    // A young settler whose age class isn't mapped falls to the default, not to byJob.
    expect(pickByJob(table, 5, true)).toBe('civilian');
  });

  it('an ADULT with a fixture job id colliding with an age class stays the default (dc3ef54)', () => {
    // The demo woodcutter is jobType 1 — the real baby_female id. Without the Age flag it must NEVER
    // draw the baby body.
    expect(pickByJob(table, 1, false)).toBe('civilian');
  });

  it('a jobless (undefined) settler picks the default', () => {
    expect(pickByJob(table, undefined, false)).toBe('civilian');
    expect(pickByJob(table, undefined, true)).toBe('civilian');
  });

  it('a table with no youngByJob sends young settlers to the default', () => {
    const bare: ByJobTable<string> = { byJob: { 5: 'woman' }, default: 'civilian' };
    expect(pickByJob(bare, 1, true)).toBe('civilian');
  });

  it('an equipped weapon good drives the ADULT look over the job; an empty/unmapped slot falls through', () => {
    const armed: ByJobTable<string> = {
      byJob: { 31: 'warrior', 40: 'warrior-shortbow' },
      byWeaponGood: { 41: 'warrior-sword', 37: 'warrior-shortbow' },
      default: 'civilian',
    };
    // A bare warrior (job 31, no weapon) keeps its job body; equip a sword good and it draws the sword body.
    expect(pickByJob(armed, 31, false)).toBe('warrior');
    expect(pickByJob(armed, 31, false, 41)).toBe('warrior-sword');
    // The weapon wins over a conflicting job — a job-40 archer holding a short-bow good still draws the bow.
    expect(pickByJob(armed, 40, false, 37)).toBe('warrior-shortbow');
    // An unmapped weapon good falls through to the job pick, not the default.
    expect(pickByJob(armed, 31, false, 999)).toBe('warrior');
    // A child never keys the weapon table even if a good is (spuriously) present.
    expect(pickByJob(armed, 3, true, 41)).toBe('civilian');
  });
});

describe('resolveResourceDraw — per-good resource node binding', () => {
  function resource(goodType?: number): DrawItem {
    return { ...item('resource'), ...(goodType !== undefined ? { goodType } : {}) };
  }

  // Each good's per-level frame list (empty→full). Wood draws a bare bob from the default resource (tree)
  // layer; stone + iron draw from their own named `.bmd` families. A single-frame list is a non-mined node.
  const binding = {
    byGood: {
      5: [60],
      3: [{ layer: 'ls_ground.rock03', bob: 10 }],
      6: [{ layer: 'ls_ground.iron01', bob: 70 }],
    },
    default: 60,
  };

  it('draws a bare bob for a good bound to the default resource layer (the yew)', () => {
    expect(resolveResourceDraw(binding, resource(5))).toEqual({ bob: 60 });
  });

  it('draws a layer-qualified bob for a good in its own named family (the mine/rock atlas)', () => {
    expect(resolveResourceDraw(binding, resource(3))).toEqual({ bob: 10, layer: 'ls_ground.rock03' });
    expect(resolveResourceDraw(binding, resource(6))).toEqual({ bob: 70, layer: 'ls_ground.iron01' });
  });

  it('falls back to the default (yew) for an unmapped or good-less node', () => {
    expect(resolveResourceDraw(binding, resource(999))).toEqual({ bob: 60 });
    expect(resolveResourceDraw(binding, resource())).toEqual({ bob: 60 });
  });

  it('indexes a mined deposit by its level (empty→full); no level / over-range → the full frame', () => {
    // A 3-level deposit — the shrink-by-level frames run empty (index 0) → full (last).
    const deposit = {
      byGood: {
        3: [
          { layer: 'ls_ground.clay01', bob: 60 }, // level 1 — dregs
          { layer: 'ls_ground.clay01', bob: 62 }, // level 2
          { layer: 'ls_ground.clay01', bob: 64 }, // level 3 — full
        ],
      },
      default: 0,
    };
    const at = (level?: number) =>
      resolveResourceDraw(deposit, { ...resource(3), ...(level !== undefined ? { level } : {}) });
    expect(at(3)).toEqual({ bob: 64, layer: 'ls_ground.clay01' }); // full
    expect(at(2)).toEqual({ bob: 62, layer: 'ls_ground.clay01' });
    expect(at(1)).toEqual({ bob: 60, layer: 'ls_ground.clay01' }); // dregs
    expect(at()).toEqual({ bob: 64, layer: 'ls_ground.clay01' }); // no level → full (a plain node)
    expect(at(99)).toEqual({ bob: 64, layer: 'ls_ground.clay01' }); // over-range clamps to full
  });

  it('a plain-number binding is the same node bob for every good', () => {
    expect(resolveResourceDraw(42, resource(5))).toEqual({ bob: 42 });
    expect(resolveResourceDraw(42, resource())).toEqual({ bob: 42 });
  });

  it('RESCALES the level ladder onto a record with a different authored state count', () => {
    // The sim buckets every deposit into 5 catalog levels, but this record authors only 4 states
    // (the real "stones 01" rock). Full (5/5) must draw the fullest frame, dregs (1/5) the first.
    const rock = {
      byGood: { 3: [10, 11, 12, 13].map((bob) => ({ layer: 'ls_ground.rock03', bob })) },
      default: 0,
    };
    const at = (level: number, levels: number) =>
      resolveResourceDraw(rock, { ...resource(3), level, levels });
    expect(at(5, 5)).toEqual({ bob: 13, layer: 'ls_ground.rock03' }); // full → fullest authored frame
    expect(at(4, 5)).toEqual({ bob: 13, layer: 'ls_ground.rock03' }); // ceil(4·4/5) = 4
    expect(at(3, 5)).toEqual({ bob: 12, layer: 'ls_ground.rock03' });
    expect(at(1, 5)).toEqual({ bob: 10, layer: 'ls_ground.rock03' }); // dregs → first frame
    // A 5-state variant under the same 5-level ladder stays the identity mapping.
    const mine = { byGood: { 3: [20, 21, 22, 23, 24] }, default: 0 };
    expect(resolveResourceDraw(mine, { ...resource(3), level: 5, levels: 5 })).toEqual({ bob: 24 });
    expect(resolveResourceDraw(mine, { ...resource(3), level: 2, levels: 5 })).toEqual({ bob: 21 });
  });

  it('indexes a GROUND DROP by its fill (unit count) — one dug ore draws the single-piece frame', () => {
    // The trunk binding routes grounddrop items through this resolver; the ore pickup records author a
    // 5-state fewest→most ladder (state ≡ units), so fill 1 → first frame, a stacked drop grows.
    const ore = {
      byGood: { 4: [30, 31, 32, 33, 34].map((bob) => ({ layer: 'ls_goods.iron', bob })) },
      default: 0,
    };
    const drop = (fill?: number): DrawItem => ({
      ...item('grounddrop'),
      goodType: 4,
      ...(fill !== undefined ? { fill } : {}),
    });
    expect(resolveResourceDraw(ore, drop(1))).toEqual({ bob: 30, layer: 'ls_goods.iron' }); // one unit
    expect(resolveResourceDraw(ore, drop(3))).toEqual({ bob: 32, layer: 'ls_goods.iron' });
    expect(resolveResourceDraw(ore, drop(99))).toEqual({ bob: 34, layer: 'ls_goods.iron' }); // clamps
    expect(resolveResourceDraw(ore, drop())).toEqual({ bob: 34, layer: 'ls_goods.iron' }); // no fill → full
  });
});

describe('resolveStockpileDraw — per-good ground piles + delivery flag', () => {
  function pile(goodType?: number, fill?: number): DrawItem {
    return {
      ...item('stockpile'),
      ...(goodType !== undefined ? { goodType } : {}),
      ...(fill !== undefined ? { fill } : {}),
    };
  }

  // Wood pile: 5 fill frames (fewest→most) from the ls_goods.goods_wood atlas; the flag from ls_temp.
  const binding = {
    byGood: {
      5: [
        { layer: 'ls_goods.goods_wood', bob: 0 },
        { layer: 'ls_goods.goods_wood', bob: 1 },
        { layer: 'ls_goods.goods_wood', bob: 2 },
        { layer: 'ls_goods.goods_wood', bob: 3 },
        { layer: 'ls_goods.goods_wood', bob: 4 },
      ],
    },
    flag: { layer: 'ls_temp.human_player01', bob: 33 },
    default: 0,
  };

  it('draws the flag for an EMPTY pile (no dominant good)', () => {
    expect(resolveStockpileDraw(binding, pile())).toEqual({ bob: 33, layer: 'ls_temp.human_player01' });
  });

  it('indexes a held pile by its fill amount (1-based), clamped into the heap frames', () => {
    expect(resolveStockpileDraw(binding, pile(5, 1))).toEqual({ bob: 0, layer: 'ls_goods.goods_wood' });
    expect(resolveStockpileDraw(binding, pile(5, 3))).toEqual({ bob: 2, layer: 'ls_goods.goods_wood' });
    expect(resolveStockpileDraw(binding, pile(5, 5))).toEqual({ bob: 4, layer: 'ls_goods.goods_wood' });
    // Over-full clamps to the fullest frame; a missing fill defaults to the smallest heap.
    expect(resolveStockpileDraw(binding, pile(5, 99))).toEqual({ bob: 4, layer: 'ls_goods.goods_wood' });
    expect(resolveStockpileDraw(binding, pile(5))).toEqual({ bob: 0, layer: 'ls_goods.goods_wood' });
  });

  it('falls back to the (bare placeholder) default for a held pile whose good has no frames', () => {
    expect(resolveStockpileDraw(binding, pile(999, 3))).toEqual({ bob: 0 });
  });

  it('draws a filled loose pile as its heap ALONE — no flag planted through the goods', () => {
    expect(resolveStockpileLayerDraws(binding, pile(5, 3))).toEqual([
      { bob: 2, layer: 'ls_goods.goods_wood' },
    ]);
  });

  it('draws an EMPTY pile as the flag marker alone (a designated collection point with nothing in it)', () => {
    expect(resolveStockpileLayerDraws(binding, pile())).toEqual([
      { bob: 33, layer: 'ls_temp.human_player01' },
    ]);
  });

  it('draws a delivery flag as the flag marker alone (it holds no goods — its heaps are separate entities)', () => {
    // A flag is a pure marker (no goodType): it resolves to the flag graphic. The goods it collects are
    // SEPARATE loose piles the scene depth-sorts a hair behind it (FLAG_PAINT_STEP), never layers of one draw.
    expect(resolveStockpileLayerDraws(binding, { ...pile(), isFlag: true })).toEqual([
      { bob: 33, layer: 'ls_temp.human_player01' },
    ]);
  });
});

describe('resolveSpriteBobId — grounddrop (freshly-felled trunk) via the trunk binding', () => {
  function drop(goodType?: number): DrawItem {
    return { ...item('grounddrop'), ...(goodType !== undefined ? { goodType } : {}) };
  }
  const bindings = {
    settler: 10,
    building: 20,
    resource: 30,
    trunk: { byGood: { 5: [{ layer: 'ls_goods.goods_trunk', bob: 70 }] }, default: 99 },
  };

  it("draws the good's pickup-stage trunk from the `trunk` binding (its own kind, not resource/stockpile)", () => {
    expect(resolveSpriteBobId(drop(5), bindings)).toBe(70);
  });

  it('falls back to the trunk default for an unmapped good', () => {
    expect(resolveSpriteBobId(drop(999), bindings)).toBe(99);
  });

  it('is a placeholder (null) when no trunk binding is present (old sheets stay valid)', () => {
    expect(resolveSpriteBobId(drop(5), { settler: 10, building: 20, resource: 30 })).toBeNull();
  });
});
