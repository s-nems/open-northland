import { indexAtlasFrames, type SpriteAtlas } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { VIKING_CHARACTERS } from '../src/catalog/roster.js';
import {
  ADULT_CHARACTER_BY_JOB,
  buildHumanBindings,
  CHARACTER_SPECS,
  carryAnimsByGood,
  carryHeadAnims,
  characterBinding,
  directionalAnimFromSeq,
  WARRIOR_SPEC_BY_WEAPON_GOOD,
  YOUNG_CHARACTER_BY_JOB,
} from '../src/content/settler-gfx/index.js';
import { WEAPON_GOOD_BY_JOB } from '../src/game/sandbox/ids/index.js';

/**
 * The settler/character render bindings: the seq→frame-range math behind `?atlas=real` (the self-verifiable
 * half of consuming the decoded `bobSequences`), the per-good carry looks, the per-character warrior
 * bindings and the [jobbasegraphics] job→character transcription. The browser half (do the pixels animate
 * right?) is the `sandbox` acceptance scene; this proves the derivation + graceful fallback without a browser.
 */

const FALLBACK = { start: 1, dirs: 8, stride: 99 } as const;

describe('directionalAnimFromSeq', () => {
  it('derives start + stride (= length / DIRS) from a named sequence', () => {
    const seqs = new Map([['walk', { name: 'walk', start: 1988, length: 96 }]]);
    expect(directionalAnimFromSeq(seqs, 'walk', {}, FALLBACK)).toEqual({ start: 1988, dirs: 8, stride: 12 });
  });

  it('applies the render-taste overrides (frames / phaseStart) on top of the extracted range', () => {
    const seqs = new Map([['chop', { name: 'chop', start: 5106, length: 120 }]]);
    expect(directionalAnimFromSeq(seqs, 'chop', { phaseStart: 9 }, FALLBACK)).toEqual({
      start: 5106,
      dirs: 8,
      stride: 15,
      phaseStart: 9,
    });
    const walk = new Map([['walk', { name: 'walk', start: 1988, length: 96 }]]);
    expect(directionalAnimFromSeq(walk, 'walk', { frames: 1 }, FALLBACK)).toEqual({
      start: 1988,
      dirs: 8,
      stride: 12,
      frames: 1,
    });
  });

  it('falls back verbatim when the sequence is absent or zero-length (a partial/old manifest)', () => {
    const empty = new Map<string, { name: string; start: number; length: number }>();
    expect(directionalAnimFromSeq(empty, 'walk', {}, FALLBACK)).toBe(FALLBACK);
    const zero = new Map([['walk', { name: 'walk', start: 1988, length: 0 }]]);
    expect(directionalAnimFromSeq(zero, 'walk', {}, FALLBACK)).toBe(FALLBACK);
  });
});

describe('buildHumanBindings', () => {
  it('derives the settler walk/chop/carry anims from the decoded sequences', () => {
    const seqs = new Map([
      ['human_man_generic_walk', { name: 'human_man_generic_walk', start: 1988, length: 96 }],
      // Idle is the WAIT sequence played SINGLE-direction (57 isn't ×8) — the full loop, not a frozen hold.
      ['human_man_generic_wait', { name: 'human_man_generic_wait', start: 1931, length: 57 }],
      [
        'human_man_woodcutter_work_woodcutting',
        { name: 'human_man_woodcutter_work_woodcutting', start: 5106, length: 120 },
      ],
      ['human_man_generic_walk_wood', { name: 'human_man_generic_walk_wood', start: 4580, length: 96 }],
    ]);
    const bindings = buildHumanBindings(seqs);
    expect(bindings.settler).toEqual({
      // Idle = the WHOLE wait strip as ONE direction (57 frames), not a facing-sliced 1/8 — and it ANIMATES.
      idle: { start: 1931, dirs: 1, stride: 57 },
      moving: { start: 1988, dirs: 8, stride: 12 },
      byAtomic: { 24: { start: 5106, dirs: 8, stride: 15, phaseStart: 9 } },
      carrying: {
        idle: { start: 4580, dirs: 8, stride: 12, frames: 1 },
        moving: { start: 4580, dirs: 8, stride: 12 },
      },
    });
  });

  it('binds idle to a full-loop single-direction wait (never a frozen hold, never a facing-sliced excerpt)', () => {
    // The never-frozen guarantee: idle is a multi-frame DirectionalAnim, not a `frames: 1` still. With no
    // decoded seq it falls back to the known-good wait range (start 1931) — single-direction (dirs 1), so
    // it plays the WHOLE 57-frame loop rather than a 1/8 slice (57 isn't a clean ×8).
    const idle = buildHumanBindings(new Map()).settler;
    const anim = typeof idle === 'number' ? undefined : idle.idle;
    expect(anim).toEqual({ start: 1931, dirs: 1, stride: 57 });
    // Not a `frames: 1` hold — the effective cycle (frames ?? stride) is the whole strip, so it animates.
    const cycle = typeof anim === 'number' || anim === undefined ? 0 : (anim.frames ?? anim.stride);
    expect(cycle).toBe(57);
  });

  it('falls back to the transcribed house table when no buildingBobs map is supplied', () => {
    // An absent IR (a checkout without content/) → buildHumanBindings is called with no second arg →
    // the binding uses the committed VIKING_HOUSE01_BOBS constant (houses.ini [GfxHouse], LogicTribeType
    // 1, GfxPalette "house01"). Pins the fallback so a stale/typo'd constant is caught here, not by eye.
    expect(buildHumanBindings(new Map()).building).toEqual({
      byType: { 6: 41, 10: 131, 11: 91, 12: 60, 15: 105 },
      default: 11,
    });
  });

  it('overlays a supplied buildingBobs map onto the constant — data wins per type, constant backs the rest', () => {
    // Live path: real data overrides per type (home 6 → a different bob) and adds growth-stage types
    // (2); the constant types the data does NOT cover (10/11/15) stay backed by VIKING_HOUSE01_BOBS, so
    // a partial IR degrades type-by-type instead of dropping the whole family to the generic box.
    expect(buildHumanBindings(new Map(), { 6: 999, 2: 1 }).building).toEqual({
      byType: { 6: 999, 10: 131, 11: 91, 12: 60, 15: 105, 2: 1 },
      default: 11,
    });
    // An empty map (the loaded atlas had no matching rows) degrades to exactly the transcribed constant.
    expect(buildHumanBindings(new Map(), {}).building).toEqual({
      byType: { 6: 41, 10: 131, 11: 91, 12: 60, 15: 105 },
      default: 11,
    });
  });

  it('passes a layer-qualified ref (a named-family building) straight through the overlay', () => {
    // The HQ binds a { layer, bob } ref into the loaded viking4 family; it must survive the spread next
    // to the constant's bare ids so the renderer draws it from the family atlas (not the default layer).
    expect(
      buildHumanBindings(new Map(), { 1: { layer: 'ls_houses_viking4.house01', bob: 34 } }).building,
    ).toEqual({
      byType: { 1: { layer: 'ls_houses_viking4.house01', bob: 34 }, 6: 41, 10: 131, 11: 91, 12: 60, 15: 105 },
      default: 11,
    });
  });

  it('falls back to the known-good ranges when the manifest is empty (fallback == data)', () => {
    // The committed FALLBACK_* ranges must equal what the real animations.ini yields, so a checkout
    // without content/ draws the same cycles as one with it. Asserting the empty-map result pins that.
    expect(buildHumanBindings(new Map()).settler).toEqual({
      idle: { start: 1931, dirs: 1, stride: 57 }, // FALLBACK_WAIT: the whole wait loop, single-direction
      moving: { start: 1988, dirs: 8, stride: 12 },
      byAtomic: { 24: { start: 5106, dirs: 8, stride: 15, phaseStart: 9 } },
      carrying: {
        idle: { start: 4580, dirs: 8, stride: 12, frames: 1 },
        moving: { start: 4580, dirs: 8, stride: 12 },
      },
    });
  });
});

describe('carryAnimsByGood', () => {
  const seqs = new Map([
    ['walk_wood', { name: 'walk_wood', start: 4580, length: 96 }],
    ['walk_stone', { name: 'walk_stone', start: 4100, length: 96 }],
    ['walk_grain', { name: 'walk_grain', start: 2852, length: 96 }],
    ['walk_iron_gold', { name: 'walk_iron_gold', start: 3044, length: 96 }],
    ['walk_odd', { name: 'walk_odd', start: 9000, length: 17 }], // not ×8 — must be skipped
  ]);

  it('maps a good whose slug matches a carry sequence verbatim', () => {
    const table = carryAnimsByGood(seqs, 'walk_', [{ typeId: 5, id: 'wood' }]);
    expect(table[5]).toEqual({
      moving: { start: 4580, dirs: 8, stride: 12 },
      idle: { start: 4580, dirs: 8, stride: 12, frames: 1 },
    });
  });

  it('maps aliased slugs (wheat→grain, iron/gold→iron_gold) onto their shared carry look', () => {
    const table = carryAnimsByGood(seqs, 'walk_', [
      { typeId: 4, id: 'wheat' },
      { typeId: 6, id: 'iron' },
      { typeId: 7, id: 'gold' },
    ]);
    expect(table[4]?.moving).toMatchObject({ start: 2852 });
    expect(table[6]?.moving).toMatchObject({ start: 3044 });
    expect(table[7]?.moving).toMatchObject({ start: 3044 }); // iron + gold share the ingot walk
  });

  it('omits a good with no carry sequence (and a non-×8 strip) — the generic gait backs it', () => {
    const table = carryAnimsByGood(seqs, 'walk_', [
      { typeId: 10, id: 'wool' }, // no walk_wool authored
      { typeId: 11, id: 'odd' }, // walk_odd exists but is not a clean ×8 strip
    ]);
    expect(table[10]).toBeUndefined();
    expect(table[11]).toBeUndefined();
  });

  it('keys the table on the CONTENT-relative good typeId (the demo wood(1) vs the real wood(5))', () => {
    const demo = carryAnimsByGood(seqs, 'walk_', [{ typeId: 1, id: 'wood' }]);
    expect(Object.keys(demo)).toEqual(['1']);
  });
});

describe('characterBinding', () => {
  const WARRIOR_SEQS = new Map([
    ['human_man_warrior_empty_wait', { name: 'human_man_warrior_empty_wait', start: 1120, length: 57 }],
    ['human_man_warrior_empty_walk', { name: 'human_man_warrior_empty_walk', start: 1177, length: 96 }],
    ['human_man_Warrior_Sword_Walk', { name: 'human_man_Warrior_Sword_Walk', start: 3283, length: 96 }],
  ]);

  it('builds a loop-wait character: idle plays the whole strip facing-locked, moving the ×8 walk', () => {
    const spec = {
      rosterId: 'warrior',
      walkSeq: 'human_man_warrior_empty_walk',
      waitSeq: 'human_man_warrior_empty_wait',
    } as const;
    expect(characterBinding(spec, WARRIOR_SEQS, [])).toEqual({
      idle: { start: 1120, dirs: 1, stride: 57 },
      moving: { start: 1177, dirs: 8, stride: 12 },
    });
  });

  it('falls back to a walk-hold idle (frame 0 per facing) when the spec names no wait strip', () => {
    const spec = {
      rosterId: 'warrior',
      walkSeq: 'human_man_Warrior_Sword_Walk',
    } as const;
    expect(characterBinding(spec, WARRIOR_SEQS, [])).toEqual({
      idle: { start: 3283, dirs: 8, stride: 12, frames: 1 },
      moving: { start: 3283, dirs: 8, stride: 12 },
    });
  });

  it('binds a non-x8 action strip facing-locked (eat/sleep/pick_up — the clipDirs reading)', () => {
    const seqs = new Map([
      ['wait', { name: 'wait', start: 1931, length: 57 }],
      ['eat', { name: 'eat', start: 1530, length: 17 }],
    ]);
    const spec = {
      rosterId: 'civilian',
      waitSeq: 'wait',
      atomics: { 10: { seq: 'eat' } },
    } as const;
    expect(characterBinding(spec, seqs, [])?.byAtomic).toEqual({
      10: { start: 1530, dirs: 1, stride: 17 },
    });
  });

  it('resolves the spec atomics into byAtomic (the setatomic join) with the phase override', () => {
    const seqs = new Map([
      ['wait', { name: 'wait', start: 1931, length: 57 }],
      ['chop', { name: 'chop', start: 5106, length: 120 }],
    ]);
    const spec = {
      rosterId: 'civilian',
      waitSeq: 'wait',
      atomics: { 24: { seq: 'chop', phaseStart: 9 } },
    } as const;
    expect(characterBinding(spec, seqs, [])?.byAtomic).toEqual({
      24: { start: 5106, dirs: 8, stride: 15, phaseStart: 9 },
    });
  });

  it('binds the attack swing as a FrameListAnim from the gfxAtomics frame lists (start from the bobseq)', () => {
    const seqs = new Map([
      ['wait', { name: 'wait', start: 1931, length: 57 }],
      ['spear_attack', { name: 'spear_attack', start: 2255, length: 108 }],
    ]);
    const spec = {
      rosterId: 'warrior',
      waitSeq: 'wait',
      attack: 'spear_attack',
    } as const;
    const frameLists = new Map<string, readonly (readonly number[])[]>([
      [
        'spear_attack',
        [
          [79, 79, 80],
          [97, 97, 98],
        ],
      ],
    ]);
    // The swing pool `start` comes from the [bobseq] row, its per-direction layout from the gfxAtomics
    // map. A PARTIAL multi-list table is still a <dir>-space table: dir 0 (E) lands on facing 4, dir 1
    // (SE) on facing 5, and the unauthored facings hold empty lists (frameOf pins the pool's first
    // frame there) — never an unremapped pass-through.
    expect(characterBinding(spec, seqs, [], frameLists)?.byAtomic).toEqual({
      81: {
        start: 2255,
        frameLists: [[], [], [], [], [79, 79, 80], [97, 97, 98], [], []],
      },
    });
  });

  it('reorders a full 8-dir frame-list table from the source <dir> space into facing order', () => {
    const seqs = new Map([
      ['wait', { name: 'wait', start: 1931, length: 57 }],
      ['spear_attack', { name: 'spear_attack', start: 2255, length: 108 }],
    ]);
    const spec = { rosterId: 'warrior', waitSeq: 'wait', attack: 'spear_attack' } as const;
    // Source <dir> order: 0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE, 6 N, 7 S (each list tagged by its dir).
    const dirLists = new Map<string, readonly (readonly number[])[]>([
      ['spear_attack', [[0], [1], [2], [3], [4], [5], [6], [7]]],
    ]);
    const swing = characterBinding(spec, seqs, [], dirLists)?.byAtomic?.[81];
    // Facing order is the strip-block compass (0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N): the
    // east-facing swing (facing 4) must play the source dir-0 (E) list, and so on around the ring —
    // GFX_DIR_TO_BLOCK = [4,5,0,1,2,3,7,6], data-pinned by the 123 human-body [gfxanimatomic] records.
    expect(swing).toEqual({
      start: 2255,
      frameLists: [[2], [3], [4], [5], [0], [1], [7], [6]],
    });
  });

  it('omits the attack swing when the frame lists are absent (no gfxAtomics for the seq)', () => {
    const seqs = new Map([
      ['wait', { name: 'wait', start: 1931, length: 57 }],
      ['spear_attack', { name: 'spear_attack', start: 2255, length: 108 }],
    ]);
    const spec = { rosterId: 'warrior', waitSeq: 'wait', attack: 'spear_attack' } as const;
    // No map passed → no attack animation bound (never a bogus uniform 108/8 slice).
    expect(characterBinding(spec, seqs, [])?.byAtomic).toBeUndefined();
  });

  it('binds the engaged gait: aggressive ×8 walk + facing-locked aggressive wait', () => {
    const seqs = new Map([
      ['wait', { name: 'wait', start: 1931, length: 57 }],
      ['aggr_walk', { name: 'aggr_walk', start: 536, length: 96 }],
      ['aggr_wait', { name: 'aggr_wait', start: 418, length: 22 }],
    ]);
    const spec = {
      rosterId: 'warrior',
      waitSeq: 'wait',
      engaged: { moving: 'aggr_walk', idle: 'aggr_wait' },
    } as const;
    expect(characterBinding(spec, seqs, [])?.engaged).toEqual({
      moving: { start: 536, dirs: 8, stride: 12 },
      idle: { start: 418, dirs: 1, stride: 22 },
    });
  });

  it('binds the per-good carry table + the wood generic fallback off the carryPrefix', () => {
    const seqs = new Map([
      ['w_wait', { name: 'w_wait', start: 10, length: 30 }],
      ['w_walk', { name: 'w_walk', start: 100, length: 96 }],
      ['w_walk_wood', { name: 'w_walk_wood', start: 200, length: 96 }],
      ['w_walk_stone', { name: 'w_walk_stone', start: 300, length: 96 }],
    ]);
    const spec = {
      rosterId: 'civilian',
      walkSeq: 'w_walk',
      waitSeq: 'w_wait',
      carryPrefix: 'w_walk_',
    } as const;
    const binding = characterBinding(spec, seqs, [
      { typeId: 3, id: 'stone' },
      { typeId: 10, id: 'wool' }, // unmapped — backed by the generic wood gait
    ]);
    expect(binding?.carrying).toEqual({
      moving: { start: 200, dirs: 8, stride: 12 },
      idle: { start: 200, dirs: 8, stride: 12, frames: 1 },
      byGood: {
        3: {
          moving: { start: 300, dirs: 8, stride: 12 },
          idle: { start: 300, dirs: 8, stride: 12, frames: 1 },
        },
      },
    });
  });

  it('a walk-less character (the baby) idles its wait and never binds moving', () => {
    const seqs = new Map([['baby_wait', { name: 'baby_wait', start: 104, length: 42 }]]);
    const spec = { rosterId: 'baby', waitSeq: 'baby_wait' } as const;
    expect(characterBinding(spec, seqs, [])).toEqual({
      idle: { start: 104, dirs: 1, stride: 42 },
    });
  });

  it('returns null when neither the walk nor a loop wait resolves (an IR without this body)', () => {
    const empty = new Map<string, { name: string; start: number; length: number }>();
    expect(characterBinding({ rosterId: 'warrior', walkSeq: 'missing' } as const, empty, [])).toBeNull();
    expect(characterBinding({ rosterId: 'civilian', waitSeq: 'missing' } as const, empty, [])).toBeNull();
  });
});

describe('the job → character tables (the [jobbasegraphics] transcription)', () => {
  it('maps the soldier family (31..41) onto the armoured warrior looks, per weapon class', () => {
    for (let job = 31; job <= 41; job++) {
      const specId = ADULT_CHARACTER_BY_JOB[job];
      expect(specId, `job ${job}`).toBeDefined();
      expect(specId?.startsWith('warrior'), `job ${job} → ${specId}`).toBe(true);
      // Every referenced spec exists and shares the warrior BODY (the skin the job change swaps in).
      expect(specId !== undefined && CHARACTER_SPECS[specId].rosterId).toBe('warrior');
    }
    expect(ADULT_CHARACTER_BY_JOB[5]).toBe('woman');
  });

  it('arming a warrior draws the same body its job does (the three weapon tables agree)', () => {
    // `pickByJob` prefers the equipped-weapon body (`WARRIOR_SPEC_BY_WEAPON_GOOD`) over the job body
    // (`ADULT_CHARACTER_BY_JOB`), so for every soldier job that spawns with a weapon good
    // (`WEAPON_GOOD_BY_JOB`), the armed look MUST equal the job's own look — otherwise arming a warrior
    // would silently reskin it. This locks the composite the render relies on across all three tables.
    for (const [jobStr, good] of Object.entries(WEAPON_GOOD_BY_JOB)) {
      const job = Number(jobStr);
      const armed = WARRIOR_SPEC_BY_WEAPON_GOOD[good];
      const byJob = ADULT_CHARACTER_BY_JOB[job];
      expect(armed, `weapon good ${good} (job ${job})`).toBeDefined();
      expect(armed, `job ${job}: armed body must match its job body`).toBe(byJob);
    }
  });

  it('maps the age classes (1..4, Age-gated) onto the baby/child bodies', () => {
    expect(YOUNG_CHARACTER_BY_JOB[1]).toBe('baby');
    expect(YOUNG_CHARACTER_BY_JOB[2]).toBe('baby');
    expect(YOUNG_CHARACTER_BY_JOB[3]).toBe('girl');
    expect(YOUNG_CHARACTER_BY_JOB[4]).toBe('boy');
    // The adult table must NOT claim the age-class ids — an adult fixture job 1..4 stays the default.
    for (const id of [1, 2, 3, 4]) expect(ADULT_CHARACTER_BY_JOB[id]).toBeUndefined();
  });

  it('every spec a job table references exists in CHARACTER_SPECS, and specs use only roster bodies', () => {
    const specIds = [...Object.values(ADULT_CHARACTER_BY_JOB), ...Object.values(YOUNG_CHARACTER_BY_JOB)];
    for (const id of specIds) expect(CHARACTER_SPECS[id], id).toBeDefined();
    for (const [id, spec] of Object.entries(CHARACTER_SPECS)) {
      expect(
        VIKING_CHARACTERS.some((c) => c.id === spec.rosterId),
        `${id} → roster '${spec.rosterId}'`,
      ).toBe(true);
    }
  });
});

describe('carryHeadAnims — the head-borrow for head-empty carry cycles', () => {
  const WALK = { start: 1988, dirs: 8, stride: 12 } as const;
  const STONE_CARRY = { start: 4100, dirs: 8, stride: 12 } as const;
  const WOOD_CARRY = { start: 4580, dirs: 8, stride: 12 } as const;
  /** A head atlas that authors the wood carry's frames but ships the stone carry empty (the real
   *  decode's shape: 19 of 27 man carry variants have no head bobs). */
  function headAtlas(): SpriteAtlas {
    return indexAtlasFrames(64, 64, [
      { bobId: WOOD_CARRY.start, rect: { x: 0, y: 0, width: 10, height: 10 }, offsetX: 0, offsetY: 0 },
      { bobId: STONE_CARRY.start, rect: { x: 0, y: 0, width: 0, height: 0 }, offsetX: 0, offsetY: 0 },
    ]);
  }
  const byGood = {
    3: { moving: STONE_CARRY, idle: { ...STONE_CARRY, frames: 1 } },
    5: { moving: WOOD_CARRY, idle: { ...WOOD_CARRY, frames: 1 } },
  };

  it('borrows the base walk for a head-empty carry cycle, keeps an authored one', () => {
    const head = carryHeadAnims(byGood, WALK, headAtlas());
    expect(head[3]).toEqual({ moving: WALK, idle: { ...WALK, frames: 1 } }); // stone: borrowed
    expect(head[5]).toBe(byGood[5]); // wood: its own authored head range
  });

  it('returns the input table BY IDENTITY when every head is authored (no head binding needed)', () => {
    const allAuthored = { 5: { moving: WOOD_CARRY, idle: { ...WOOD_CARRY, frames: 1 } } };
    expect(carryHeadAnims(allAuthored, WALK, headAtlas())).toBe(allAuthored);
  });

  it('returns the input table when there is no walk to borrow', () => {
    expect(carryHeadAnims(byGood, undefined, headAtlas())).toBe(byGood);
  });
});
