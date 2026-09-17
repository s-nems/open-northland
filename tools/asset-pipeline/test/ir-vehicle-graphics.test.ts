import { VehicleType } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import {
  extractBobSequences,
  extractGfxAnimAtomics,
  extractGfxWalkAtomics,
  extractPaletteIndex,
  extractRawFrameAtomics,
  extractRawFrameGaits,
  extractVehicleGraphicsBindings,
  parseIniSections,
} from '../src/decoders/ini.js';
import {
  buildVehicleGraphics,
  mergeVehicleBindings,
  paletteFamily,
  type SourcedVehicleBinding,
} from '../src/stages/ir/vehicle-graphics.js';

const ANIM_SRC = { file: 'animations.ini', layer: 'mod' as const };
const MOD_SRC = { file: 'DataCnmd/types/vehiclestype/jobgraphics.ini', layer: 'mod' as const };
const BASE_SRC = { file: 'Data/engine2d/inis/vehicles/jobgraphics.cif', layer: 'base' as const };

// The real vehicle rows, trimmed to two facings: the handcart's wait is one frame of a one-frame
// `[bobseq]` run and its drive reuses the bullcart walk, while the ship's rows carry bob ids directly.
const ANIMATIONS_INI = [
  '[bobseq]',
  'imagelib "CR_Veh_Body_00.bmd"',
  'shadowlib "CR_Veh_Body_00_S.bmd"',
  'seq "vehicles_bullcart_walk" 48 96',
  'seq "vehicles_handcart_wait" 305 1',
  '[gfxanimatomic]',
  'logictribe 1',
  'logicjob 50',
  'logicatomicaction 2',
  'gfxanimmode 0',
  'gfxbobseqbody "vehicles_handcart_wait"',
  'gfxanimframelistdir 0 0',
  'gfxanimframelistdir 1 0',
  '[gfxwalkatomic]',
  'logictribe 1',
  'logicjob 50',
  'logicgoodtype 0',
  'gfxbobseqbody "vehicles_bullcart_walk"',
  'gfxwalkframelist 0 48 49',
  'gfxwalkframelist 1 60 61',
  '[gfxanimatomic]',
  'logictribe 1',
  'logicjob 52',
  'logicatomicaction 4',
  'gfxanimmode 0',
  'gfxanimframelistdir 0 74',
  'gfxanimframelistdir 1 78',
  '[gfxanimatomic]',
  'logictribe 1',
  'logicjob 52',
  'logicatomicaction 2',
  'gfxanimmode 0',
  'gfxanimframelistdir 0 8',
  'gfxanimframelistdir 1 12',
  '[gfxwalkatomic]',
  'logictribe 1',
  'logicjob 52',
  'logicgoodtype 0',
  'gfxwalkframelist 0 8',
  'gfxwalkframelist 1 12',
  'gfxturnframelist 0 8 9',
  'gfxturnframelist 1 12 13',
  '[gfxanimatomic]', // another tribe's ship: not this tribe's row
  'logictribe 2',
  'logicjob 52',
  'logicatomicaction 2',
  'gfxanimmode 0',
  'gfxanimframelistdir 0 42',
].join('\n');

const VEHICLE_JOBGRAPHICS_INI = [
  '[jobgraphics]',
  'logictribe 1',
  'logicvehicle 1',
  'gfxbobmanagerbody "Data\\Engine2D\\Bin\\Bobs\\CR_Veh_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Veh_Body_00_s.bmd"',
  'gfxpalettebody "goods01"',
  '[jobgraphics]',
  'logictribe 1',
  'logicvehicle 3',
  'gfxbobmanagerbody "Data\\Engine2D\\Bin\\Bobs\\LS_vehicles.bmd" "Data\\Engine2D\\Bin\\Bobs\\LS_vehicles_s.bmd"',
  'gfxpalettebody "human_Ship01"',
  '[jobgraphics]', // a type the vehicle table lacks: no row
  'logictribe 1',
  'logicvehicle 9',
  'gfxbobmanagerbody "Data\\Engine2D\\Bin\\Bobs\\CR_Veh_Body_00.bmd"',
  'gfxpalettebody "goods01"',
].join('\n');

const PALETTES_INI = [
  '[GfxPalette256]',
  'editname "goods01"',
  'gfxfile "data\\engine2d\\bin\\palettes\\creatures\\goods01.pcx"',
  '[GfxPalette256]',
  'editname "human_Ship01"',
  'gfxfile "data\\engine2d\\bin\\palettes\\creatures\\Ship01.pcx"',
  '[GfxPalette256]',
  'editname "human_Ship02"',
  'gfxfile "data\\engine2d\\bin\\palettes\\creatures\\Ship02.pcx"',
  '[GfxPalette256]',
  'editname "human_Ship03"',
  'gfxfile "data\\engine2d\\bin\\palettes\\creatures\\Ship03.pcx"',
  '[GfxPalette256]', // past the gap at 04: not a member
  'editname "human_Ship05"',
  'gfxfile "data\\engine2d\\bin\\palettes\\creatures\\Ship05.pcx"',
].join('\n');

const VEHICLES = [
  VehicleType.parse({ typeId: 1, id: 'handcart', jobId: 50 }),
  VehicleType.parse({ typeId: 3, id: 'ship_small', jobId: 52 }),
];

function input() {
  const anim = parseIniSections(ANIMATIONS_INI);
  return {
    bindings: extractVehicleGraphicsBindings(parseIniSections(VEHICLE_JOBGRAPHICS_INI)).map((binding) => ({
      binding,
      src: MOD_SRC,
    })),
    vehicles: VEHICLES,
    bobSequences: extractBobSequences(anim, ANIM_SRC),
    gfxAtomics: extractGfxAnimAtomics(anim, ANIM_SRC),
    gfxWalkAtomics: extractGfxWalkAtomics(anim, ANIM_SRC),
    rawAtomics: extractRawFrameAtomics(anim),
    rawGaits: extractRawFrameGaits(anim),
    palettes: extractPaletteIndex(parseIniSections(PALETTES_INI)),
  };
}

describe('buildVehicleGraphics', () => {
  it('resolves the sequence-bound cart rows to bob ids of the cart body', () => {
    const [handcart] = buildVehicleGraphics(input());
    expect(handcart).toEqual({
      tribe: 1,
      vehicleType: 1,
      job: 50,
      body: 'data/engine2d/bin/bobs/cr_veh_body_00.bmd',
      shadowBody: 'data/engine2d/bin/bobs/cr_veh_body_00_s.bmd',
      bodyPalette: 'goods01',
      clips: [{ action: 2, dirFrames: [[305], [305]] }], // seq start 305 + local 0
      gaits: [
        {
          goodType: 0,
          dirFrames: [
            [96, 97], // seq start 48 + local 48..49
            [108, 109],
          ],
        },
      ],
      source: { file: MOD_SRC.file, block: 'jobgraphics', layer: 'mod' },
    });
  });

  it('keeps the raw ship rows as they are, sorted by action, with turns and the player palettes', () => {
    const rows = buildVehicleGraphics(input());
    expect(rows).toHaveLength(2); // the unknown type 9 yields no row
    const [, ship] = rows;
    expect(ship).toMatchObject({
      tribe: 1,
      vehicleType: 3,
      job: 52,
      body: 'data/engine2d/bin/bobs/ls_vehicles.bmd',
      bodyPalette: 'human_ship01',
      playerPalettes: ['human_ship01', 'human_ship02', 'human_ship03'],
      clips: [
        { action: 2, dirFrames: [[8], [12]] },
        { action: 4, dirFrames: [[74], [78]] },
      ],
      gaits: [
        {
          goodType: 0,
          dirFrames: [[8], [12]],
          turnFrames: [
            [8, 9],
            [12, 13],
          ],
        },
      ],
    });
  });

  it('drops a row naming a sequence the body lacks, with a warning, and keeps the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const base = input();
      const [handcart] = buildVehicleGraphics({
        ...base,
        gfxAtomics: base.gfxAtomics.map((row) => ({ ...row, bodySeq: 'vehicles_missing' })),
      });
      expect(handcart?.clips).toEqual([]);
      expect(handcart?.gaits).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('has no sequence vehicles_missing'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('paletteFamily', () => {
  const palettes = extractPaletteIndex(parseIniSections(PALETTES_INI));

  it('walks a numbered family from its first member to the first gap', () => {
    expect(paletteFamily('human_ship01', palettes)).toEqual(['human_ship01', 'human_ship02', 'human_ship03']);
  });

  it('is undefined for a lone member, a later member, and an unnumbered palette', () => {
    expect(paletteFamily('goods01', palettes)).toBeUndefined();
    expect(paletteFamily('human_ship02', palettes)).toBeUndefined();
    expect(paletteFamily('oxcart', palettes)).toBeUndefined();
  });
});

describe('mergeVehicleBindings', () => {
  it('keeps the first layer`s binding per (tribe, vehicle) and adds the rest', () => {
    const binding = (tribeId: number, vehicleType: number, paletteName: string) => ({
      tribeId,
      vehicleType,
      bmd: 'data/engine2d/bin/bobs/cr_veh_body_00.bmd',
      shadowBmd: undefined,
      paletteName,
    });
    const mod: SourcedVehicleBinding[] = [{ binding: binding(1, 2, 'oxcart'), src: MOD_SRC }];
    const base: SourcedVehicleBinding[] = [
      { binding: binding(1, 2, 'goods01'), src: BASE_SRC },
      { binding: binding(4, 3, 'human_ship01'), src: BASE_SRC },
    ];
    expect(
      mergeVehicleBindings([mod, base]).map((r) => [
        r.binding.tribeId,
        r.binding.vehicleType,
        r.binding.paletteName,
        r.src.layer,
      ]),
    ).toEqual([
      [1, 2, 'oxcart', 'mod'],
      [4, 3, 'human_ship01', 'base'],
    ]);
  });
});
