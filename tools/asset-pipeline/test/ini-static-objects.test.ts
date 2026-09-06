import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import { cifLinesToSections, extractStaticObjects, parseIniSections } from '../src/decoders/ini.js';

describe('extractStaticObjects', () => {
  // Mirrors a real map.cif `StaticObjects` section: sethouse and sethuman (both 0-based player,
  // sethouse's fourth column is the constant 1 - see the extractor doc), setanimal, plus an
  // `addgoods` run stocking the sethouse it follows (the real grammar - `addgoods "<good>" <count>`,
  // e.g. SPECJALNA- FORTECA's HQs). All coordinates are half-cells (the emla 2W×2H lattice).
  const staticObjectsLines: CifLine[] = [
    { level: 1, text: 'StaticObjects' },
    { level: 2, text: 'sethouse 5 "viking headquarters house" 0 1 171 330 2' },
    { level: 2, text: 'addgoods "wheat" 15' },
    { level: 2, text: 'addgoods "wood" 10' },
    { level: 2, text: 'sethouse 2 "viking barracks" 1 1 164 364 0' },
    { level: 2, text: 'sethuman 0 "viking" "baby_female" 385 101 0 0' },
    { level: 2, text: 'sethuman 1 "viking" "soldier_bow_long" 120 44 0 0' },
    { level: 2, text: 'setanimal 6 "deer" "adult" 50 60 0 0' },
    { level: 2, text: 'addgoods "meat" 5' }, // follows setanimal, not a house - dropped
  ];

  it('extracts sethouse/sethuman/setanimal rows verbatim (names + half-cells + original player bases)', () => {
    const out = extractStaticObjects(cifLinesToSections(staticObjectsLines));
    expect(out).toEqual({
      buildings: [
        {
          name: 'viking headquarters house',
          level: 0,
          player: 5,
          hx: 171,
          hy: 330,
          missionId: 2,
          goods: [
            { name: 'wheat', count: 15 },
            { name: 'wood', count: 10 },
          ],
        },
        { name: 'viking barracks', level: 1, player: 2, hx: 164, hy: 364 },
      ],
      humans: [
        { tribe: 'viking', role: 'baby_female', player: 0, hx: 385, hy: 101 },
        { tribe: 'viking', role: 'soldier_bow_long', player: 1, hx: 120, hy: 44 },
      ],
      animals: [{ species: 'deer', player: 6, hx: 50, hy: 60 }],
      vehicles: [],
      guides: [],
    });
  });

  // Mission scripts address placements by the id column, and `sethuman`'s last column is the
  // behaviour mask the `*BehaviourFlag` results share. Both are omitted at the corpus's "none" zero.
  it('keeps the mission object ids, the behaviour columns, and the setvehicle/setguide verbs', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethouse 1 "frank castle" 0 1 56 104 910' },
      { level: 2, text: 'sethuman 6 "viking" "soldier_sword_short" 367 163 100 16937' },
      { level: 2, text: 'setanimal 20 "boars" "adult_animal" 41 194 0 9' },
      { level: 2, text: 'setvehicle 1 "viking" "catapult" 114 218 7' },
      { level: 2, text: 'addgoods "stone" 12' },
      { level: 2, text: 'setguide 3 141 51' },
    ];
    expect(extractStaticObjects(cifLinesToSections(lines))).toEqual({
      buildings: [{ name: 'frank castle', level: 0, player: 1, hx: 56, hy: 104, missionId: 910 }],
      humans: [
        {
          tribe: 'viking',
          role: 'soldier_sword_short',
          player: 6,
          hx: 367,
          hy: 163,
          missionId: 100,
          behaviourFlags: 16937,
        },
      ],
      animals: [{ species: 'boars', player: 20, hx: 41, hy: 194, behaviour: 9 }],
      vehicles: [
        {
          tribe: 'viking',
          type: 'catapult',
          player: 1,
          hx: 114,
          hy: 218,
          missionId: 7,
          goods: [{ name: 'stone', count: 12 }],
        },
      ],
      guides: [{ player: 3, hx: 141, hy: 51 }],
    });
  });

  // The real in-block shapes (source basis: the unpacked `staticobjects.inc` corpus) - a modifier directly
  // after its `sethuman`, and one separated from it by a modifier the decoder still drops.
  it('attaches setproducedgood and attachtohouse to their sethuman, across intervening modifiers', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethuman 2 "byzantine" "collector" 220 206 0 0' },
      { level: 2, text: 'setproducedgood "wood"' },
      { level: 2, text: 'sethuman 0 "saracen" "fisher" 359 366 0 0' },
      { level: 2, text: 'setexpierence 4 13' }, // uncaptured, and does not end the block
      { level: 2, text: 'attachtohouse 359 358 2' },
      { level: 2, text: 'setproducedgood "fish"' },
      { level: 2, text: 'sethuman 1 "viking" "collector" 12 14 0 0' }, // no pick - gathers everything
    ];
    expect(extractStaticObjects(cifLinesToSections(lines))?.humans).toEqual([
      { tribe: 'byzantine', role: 'collector', player: 2, hx: 220, hy: 206, producedGood: 'wood' },
      {
        tribe: 'saracen',
        role: 'fisher',
        player: 0,
        hx: 359,
        hy: 366,
        producedGood: 'fish',
        attach: [{ hx: 359, hy: 358, slot: 2 }],
      },
      { tribe: 'viking', role: 'collector', player: 1, hx: 12, hy: 14 },
    ]);
  });

  // 14 corpus humans carry two rows in one block, always slot 1 then slot 2.
  it('keeps both attachtohouse rows of one human, in source order', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethuman 0 "frank" "joiner" 1493 291 0 0' },
      { level: 2, text: 'attachtohouse 1490 280 1' },
      { level: 2, text: 'attachtohouse 1514 280 2' },
    ];
    expect(extractStaticObjects(cifLinesToSections(lines))?.humans).toEqual([
      {
        tribe: 'frank',
        role: 'joiner',
        player: 0,
        hx: 1493,
        hy: 291,
        attach: [
          { hx: 1490, hy: 280, slot: 1 },
          { hx: 1514, hy: 280, slot: 2 },
        ],
      },
    ]);
  });

  it('drops an attachtohouse with no human, a short one, and one across a placement verb', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'attachtohouse 10 12 1' }, // before any human - nothing to attach to
      { level: 2, text: 'sethuman 0 "viking" "smith" 10 12 0 0' },
      { level: 2, text: 'attachtohouse 20 22' }, // no slot column - malformed
      { level: 2, text: 'setanimal 6 "deer" "adult" 50 60 0 0' }, // a new placement ends the block
      { level: 2, text: 'attachtohouse 30 32 2' }, // its human is out of scope - dropped
    ];
    expect(extractStaticObjects(cifLinesToSections(lines))?.humans).toEqual([
      { tribe: 'viking', role: 'smith', player: 0, hx: 10, hy: 12 },
    ]);
  });

  // The corpus authors two stray slots (one 0, one 32) beside the 1/2 pair.
  it('keeps an unknown attachtohouse slot verbatim', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethuman 4 "viking" "smith" 344 382 0 0' },
      { level: 2, text: 'attachtohouse 339 382 32' },
    ];
    expect(extractStaticObjects(cifLinesToSections(lines))?.humans).toEqual([
      {
        tribe: 'viking',
        role: 'smith',
        player: 4,
        hx: 344,
        hy: 382,
        attach: [{ hx: 339, hy: 382, slot: 32 }],
      },
    ]);
  });

  it('lets a setguide end the enclosing sethuman block, like every other placement verb', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethuman 0 "viking" "collector" 10 12 0 0' },
      { level: 2, text: 'setguide 3 141 51' }, // a placement of its own - it ends the block
      { level: 2, text: 'setproducedgood "wood"' }, // no human in scope - dropped
      { level: 2, text: 'attachtohouse 30 32 2' }, // likewise
    ];
    const out = extractStaticObjects(cifLinesToSections(lines));
    expect(out?.humans).toEqual([{ tribe: 'viking', role: 'collector', player: 0, hx: 10, hy: 12 }]);
    expect(out?.guides).toEqual([{ player: 3, hx: 141, hy: 51 }]);
  });

  it('does not attach setproducedgood across a placement verb or a skipped sethuman', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethuman 0 "viking" "collector" 10 12 0 0' },
      { level: 2, text: 'setanimal 6 "deer" "adult" 50 60 0 0' }, // a new placement ends the block
      { level: 2, text: 'setproducedgood "wood"' }, // no human to pick for - dropped
      { level: 2, text: 'sethuman 1 "viking" "collector"' }, // truncated - skipped, retargets the pick away
      { level: 2, text: 'setproducedgood "stone"' }, // its human was skipped - dropped
    ];
    expect(extractStaticObjects(cifLinesToSections(lines))?.humans).toEqual([
      { tribe: 'viking', role: 'collector', player: 0, hx: 10, hy: 12 },
    ]);
  });

  it('skips a malformed row without dropping the rest', () => {
    const withBad: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethouse 5 "viking barracks"' }, // truncated: no level/player/coords
      { level: 2, text: 'sethuman 0 "viking" "builder" 10 12 0 0' },
    ];
    const out = extractStaticObjects(cifLinesToSections(withBad));
    expect(out?.buildings).toEqual([]);
    expect(out?.humans).toEqual([{ tribe: 'viking', role: 'builder', player: 0, hx: 10, hy: 12 }]);
  });

  it('does not attach addgoods across a skipped sethouse or a malformed/zero-count row', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethouse 0 "viking headquarters house" 0 1 10 10 0' },
      { level: 2, text: 'sethouse 1 "viking barracks"' }, // truncated - skipped, retargets goods away
      { level: 2, text: 'addgoods "wheat" 15' }, // its house was skipped - dropped
      { level: 2, text: 'sethouse 2 "viking barn" 0 1 20 20 0' },
      { level: 2, text: 'addgoods "wood"' }, // no count - skipped
      { level: 2, text: 'addgoods "stone" 0' }, // zero count - skipped
      { level: 2, text: 'addgoods "flour" 5' },
    ];
    const out = extractStaticObjects(cifLinesToSections(lines));
    expect(out?.buildings).toEqual([
      { name: 'viking headquarters house', level: 0, player: 0, hx: 10, hy: 10 },
      { name: 'viking barn', level: 0, player: 2, hx: 20, hy: 20, goods: [{ name: 'flour', count: 5 }] },
    ]);
  });

  it('returns undefined when the section is absent or places nothing', () => {
    expect(extractStaticObjects(cifLinesToSections([{ level: 1, text: 'misc_maptype' }]))).toBeUndefined();
    const empty: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'addgoods "wood" 10' }, // stock with no preceding house places nothing
    ];
    expect(extractStaticObjects(cifLinesToSections(empty))).toBeUndefined();
  });

  it('extracts the SAME rows from an unpacked map plaintext staticobjects.inc', () => {
    // The CnMod majority ship no map.cif - their StaticObjects live in a readable `staticobjects.inc`
    // parsed via parseIniSections (the pipeline's plaintext route), with addgoods/setproducedgood/
    // trailing columns interspersed exactly as the real files carry them (magiczny_las, blekiny_nurt).
    // The extractor must read it identically to the cif path - that join is what makes those maps import.
    const inc = [
      '[StaticObjects]',
      'sethouse 0 "viking headquarters" 0 1 81 78 1002',
      'addgoods "food_simple" 75',
      'addgoods "water" 10',
      'sethuman 6 "viking" "soldier_sword_short" 397 182 0 16937',
      'setanimal 20 "cattle" "adult_animal" 68 77 0 0',
      'setproducedgood "wood"',
    ].join('\n');
    expect(extractStaticObjects(parseIniSections(inc))).toEqual({
      buildings: [
        {
          name: 'viking headquarters',
          level: 0,
          player: 0,
          hx: 81,
          hy: 78,
          missionId: 1002,
          goods: [
            { name: 'food_simple', count: 75 },
            { name: 'water', count: 10 },
          ],
        },
      ],
      humans: [
        { tribe: 'viking', role: 'soldier_sword_short', player: 6, hx: 397, hy: 182, behaviourFlags: 16937 },
      ],
      animals: [{ species: 'cattle', player: 20, hx: 68, hy: 77 }],
      vehicles: [],
      guides: [],
    });
  });
});
