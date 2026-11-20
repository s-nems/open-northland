import { MAP_ADDITIONS_FILE, MAP_ADDITIONS_VERSION, MapModules } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { convertMapFolder } from '../src/convert.js';
import { MapImportError } from '../src/errors.js';
import { mapIdFromFolderName } from '../src/folders.js';
import { treeOf } from './support/folder.js';
import { mapDat, plaintextMap } from './support/maps.js';

const NAME = 'Forteca Ragnarok';
const BASE_FOLDER = 'SPECJALNA- FORTECA';
/** The ids `plaintextMap` writes its name and description under. */
const NAME_STRING = 0;
const DESCRIPTION_STRING = 1;
const UNKNOWN_STRING = 99;
/** The roster seat `plaintextMap` gives the computer, and one it has none at. */
const AI_SEAT = 1;
const MISSING_SEAT = 5;
const ORE_YIELD = 3;

const MODULES = {
  deathDrops: { version: 1, withheldSeats: [AI_SEAT] },
  heroes: {
    version: 1,
    placed: [
      {
        seat: AI_SEAT,
        job: 'soldier',
        tribe: 'frank',
        x: 0,
        y: 0,
        hitpoints: 100,
        nameStringId: NAME_STRING,
      },
    ],
  },
};

function additions(over: Record<string, unknown> = {}) {
  return {
    version: MAP_ADDITIONS_VERSION,
    mode: { of: BASE_FOLDER, name: NAME_STRING, detail: DESCRIPTION_STRING },
    roomDefaults: { oreYield: ORE_YIELD },
    modules: MODULES,
    ...over,
  };
}

function convert(file: unknown, files: Record<string, string | Uint8Array> = plaintextMap(NAME)) {
  return convertMapFolder(treeOf({ ...files, [MAP_ADDITIONS_FILE]: JSON.stringify(file) }), '', {
    provenance: 'mod',
  });
}

async function refusal(promise: Promise<unknown>): Promise<MapImportError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof MapImportError) return err;
    throw err;
  }
  throw new Error('expected a MapImportError');
}

describe('a map folder with opennorthland.json', () => {
  it('puts the modules into the script and the mode and room defaults into meta and the index', async () => {
    const map = await convert(additions());
    const mode = {
      of: mapIdFromFolderName(BASE_FOLDER),
      name: { pol: NAME },
      detail: { pol: 'Opis' },
    };

    expect(map.script?.modules).toEqual(MapModules.parse(MODULES));
    expect(map.meta).toMatchObject({ mode, roomDefaults: { oreYield: ORE_YIELD } });
    expect(map.index).toMatchObject({ mode, roomDefaults: { oreYield: ORE_YIELD } });
  });

  it('fails the map on a file it cannot take', async () => {
    const unknownString = {
      ...MODULES,
      heroes: { ...MODULES.heroes, placed: [{ ...MODULES.heroes.placed[0], nameStringId: UNKNOWN_STRING }] },
    };
    const scriptless = { 'map.dat': mapDat(), 'text/pol/strings.ini': `[text]\nstring "${NAME}"\n` };
    const bad: [Promise<unknown>, string][] = [
      [convert(additions({ version: MAP_ADDITIONS_VERSION + 1 })), 'version'],
      [convert(additions({ mode: { of: BASE_FOLDER, name: UNKNOWN_STRING } })), `string ${UNKNOWN_STRING}`],
      [convert(additions({ modules: unknownString })), `string ${UNKNOWN_STRING}`],
      [
        convert(additions({ modules: { deathDrops: { version: 1, withheldSeats: [MISSING_SEAT] } } })),
        `seat ${MISSING_SEAT}`,
      ],
      [convert({ version: MAP_ADDITIONS_VERSION, modules: MODULES }, scriptless), 'script'],
      [convert(additions({ mode: { of: '--', name: NAME_STRING } })), 'mode.of'],
      [
        convert(
          additions({
            objects: [{ hx: 0, hy: 0, from: null, to: { type: 'wall_01', level: 100, owner: 0 } }],
          }),
        ),
        'landscape objects',
      ],
    ];
    for (const [promise, why] of bad) {
      const err = await refusal(promise);
      expect(err.kind).toBe('decode-failed');
      expect(err.message).toContain(MAP_ADDITIONS_FILE);
      expect(err.message).toContain(why);
    }
  });

  it('converts a folder without the file as before', async () => {
    const map = await convertMapFolder(treeOf(plaintextMap(NAME)), '', { provenance: 'mod' });
    expect(map.script?.modules).toBeUndefined();
    expect(map.meta.mode).toBeUndefined();
    expect(map.index.mode).toBeUndefined();
  });
});
