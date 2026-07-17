import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import {
  cifLinesToSections,
  extractMapInfo,
  extractStaticObjects,
  parseIniSections,
} from '../src/decoders/ini.js';

describe('extractMapInfo', () => {
  // Mirrors a real map.cif logic header (decoded by cifLinesToSections): a `logiccontrol` section with
  // `mapsize`/`mapguid`, then `misc_maptype`/`misc_mapname` metadata. A campaign map carries
  // `mapcampaignid`; a skirmish map omits it. The 16 guid bytes are a sentinel sequence.
  const guidBytes = '163 83 223 158 154 162 179 64 171 63 228 184 223 25 120 150';
  const campaignMapLines: CifLine[] = [
    { level: 1, text: 'logiccontrol' },
    { level: 2, text: 'version 1' },
    { level: 2, text: 'mapsize 142 146' },
    { level: 2, text: `mapguid ${guidBytes}` },
    { level: 1, text: 'logiccontrolend' },
    { level: 1, text: 'MissionData' },
    { level: 2, text: 'goal "True"' },
    { level: 1, text: 'misc_maptype' },
    { level: 2, text: 'maptype 1' },
    { level: 2, text: 'mapcampaignid 100 2' },
    { level: 1, text: 'misc_mapname' },
    { level: 2, text: 'mapnamestringid 99' },
    { level: 2, text: 'mapdescriptionstringid 98' },
  ];

  it('extracts the declarative logic-header metadata into a validated MapInfo', () => {
    const info = extractMapInfo(cifLinesToSections(campaignMapLines), 'tutorial_002', {
      file: 'tutorial_002/map.cif',
    });
    expect(info).toMatchObject({
      id: 'tutorial_002',
      width: 142,
      height: 146,
      mapType: 1,
      campaign: { campaignId: 100, missionId: 2 },
      nameStringId: 99,
      descriptionStringId: 98,
    });
    expect(info.guid).toEqual([163, 83, 223, 158, 154, 162, 179, 64, 171, 63, 228, 184, 223, 25, 120, 150]);
    // The scripting payload (MissionData) is deliberately NOT folded into the metadata IR.
    expect(Object.keys(info)).not.toContain('missions');
  });

  it('omits mapcampaignid on a skirmish map (the optional field is simply absent)', () => {
    const skirmish: CifLine[] = [
      { level: 1, text: 'logiccontrol' },
      { level: 2, text: 'mapsize 250 250' },
      { level: 2, text: `mapguid ${guidBytes}` },
      { level: 1, text: 'misc_maptype' },
      { level: 2, text: 'maptype 4' },
    ];
    const info = extractMapInfo(cifLinesToSections(skirmish), 'forteca', { file: 'forteca/map.cif' });
    expect(info.mapType).toBe(4);
    expect(info.campaign).toBeUndefined();
    expect(info.nameStringId).toBeUndefined();
  });

  it('throws when mapsize is missing or malformed (not a decodable map)', () => {
    const noSize: CifLine[] = [
      { level: 1, text: 'logiccontrol' },
      { level: 2, text: `mapguid ${guidBytes}` },
    ];
    expect(() => extractMapInfo(cifLinesToSections(noSize), 'x', { file: 'x/map.cif' })).toThrow(/mapsize/);
  });

  it('throws when mapguid is not exactly 16 bytes', () => {
    const shortGuid: CifLine[] = [
      { level: 1, text: 'logiccontrol' },
      { level: 2, text: 'mapsize 100 100' },
      { level: 2, text: 'mapguid 1 2 3' },
    ];
    expect(() => extractMapInfo(cifLinesToSections(shortGuid), 'x', { file: 'x/map.cif' })).toThrow(
      /mapguid/,
    );
  });

  it('throws when the logiccontrol section is absent entirely', () => {
    const noLogic: CifLine[] = [
      { level: 1, text: 'misc_maptype' },
      { level: 2, text: 'maptype 4' },
    ];
    expect(() => extractMapInfo(cifLinesToSections(noLogic), 'x', { file: 'x/map.cif' })).toThrow(
      /logiccontrol/,
    );
  });
});

describe('extractStaticObjects', () => {
  // Mirrors a real map.cif `StaticObjects` section: sethouse and sethuman (both 0-based player,
  // sethouse's fourth column is the constant 1 — see the extractor doc), setanimal, plus an
  // `addgoods` run stocking the sethouse it follows (the real grammar — `addgoods "<good>" <count>`,
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
    { level: 2, text: 'addgoods "meat" 5' }, // follows setanimal, not a house — dropped
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
          rot: 2,
          goods: [
            { name: 'wheat', count: 15 },
            { name: 'wood', count: 10 },
          ],
        },
        { name: 'viking barracks', level: 1, player: 2, hx: 164, hy: 364, rot: 0 },
      ],
      humans: [
        { tribe: 'viking', role: 'baby_female', player: 0, hx: 385, hy: 101 },
        { tribe: 'viking', role: 'soldier_bow_long', player: 1, hx: 120, hy: 44 },
      ],
      animals: [{ species: 'deer', hx: 50, hy: 60 }],
    });
  });

  // The real `setproducedgood` shapes (source basis: the unpacked `staticobjects.inc` corpus) — the verb
  // directly after its `sethuman`, and separated from it by the in-block modifiers the decoder drops.
  it('attaches setproducedgood to its sethuman, across intervening in-block modifiers', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethuman 2 "byzantine" "collector" 220 206 0 0' },
      { level: 2, text: 'setproducedgood "wood"' },
      { level: 2, text: 'sethuman 0 "saracen" "fisher" 359 366 0 0' },
      { level: 2, text: 'setexpierence 4 13' },
      { level: 2, text: 'attachtohouse 359 358 2' },
      { level: 2, text: 'setproducedgood "fish"' },
      { level: 2, text: 'sethuman 1 "viking" "collector" 12 14 0 0' }, // no pick — gathers everything
    ];
    expect(extractStaticObjects(cifLinesToSections(lines))?.humans).toEqual([
      { tribe: 'byzantine', role: 'collector', player: 2, hx: 220, hy: 206, producedGood: 'wood' },
      { tribe: 'saracen', role: 'fisher', player: 0, hx: 359, hy: 366, producedGood: 'fish' },
      { tribe: 'viking', role: 'collector', player: 1, hx: 12, hy: 14 },
    ]);
  });

  it('does not attach setproducedgood across a placement verb or a skipped sethuman', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'StaticObjects' },
      { level: 2, text: 'sethuman 0 "viking" "collector" 10 12 0 0' },
      { level: 2, text: 'setanimal 6 "deer" "adult" 50 60 0 0' }, // a new placement ends the block
      { level: 2, text: 'setproducedgood "wood"' }, // no human to pick for — dropped
      { level: 2, text: 'sethuman 1 "viking" "collector"' }, // truncated — skipped, retargets the pick away
      { level: 2, text: 'setproducedgood "stone"' }, // its human was skipped — dropped
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
      { level: 2, text: 'sethouse 1 "viking barracks"' }, // truncated — skipped, retargets goods away
      { level: 2, text: 'addgoods "wheat" 15' }, // its house was skipped — dropped
      { level: 2, text: 'sethouse 2 "viking barn" 0 1 20 20 0' },
      { level: 2, text: 'addgoods "wood"' }, // no count — skipped
      { level: 2, text: 'addgoods "stone" 0' }, // zero count — skipped
      { level: 2, text: 'addgoods "flour" 5' },
    ];
    const out = extractStaticObjects(cifLinesToSections(lines));
    expect(out?.buildings).toEqual([
      { name: 'viking headquarters house', level: 0, player: 0, hx: 10, hy: 10, rot: 0 },
      {
        name: 'viking barn',
        level: 0,
        player: 2,
        hx: 20,
        hy: 20,
        rot: 0,
        goods: [{ name: 'flour', count: 5 }],
      },
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
    // The CnMod majority ship no map.cif — their StaticObjects live in a readable `staticobjects.inc`
    // parsed via parseIniSections (the pipeline's plaintext route), with addgoods/setproducedgood/
    // trailing columns interspersed exactly as the real files carry them (magiczny_las, blekiny_nurt).
    // The extractor must read it identically to the cif path — that join is what makes those maps import.
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
          rot: 1002,
          goods: [
            { name: 'food_simple', count: 75 },
            { name: 'water', count: 10 },
          ],
        },
      ],
      humans: [{ tribe: 'viking', role: 'soldier_sword_short', player: 6, hx: 397, hy: 182 }],
      animals: [{ species: 'cattle', hx: 68, hy: 77 }],
    });
  });
});
