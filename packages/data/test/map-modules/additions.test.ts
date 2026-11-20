import { describe, expect, it } from 'vitest';
import { MAP_ADDITIONS_VERSION, MapAdditionsFile } from '../../src/index.js';
import { MODULES } from './fixture.js';

const MODE_NAME_STRING = 9100;
const FILE = {
  version: MAP_ADDITIONS_VERSION,
  mode: { of: 'SPECJALNA- FORTECA', name: MODE_NAME_STRING },
  roomDefaults: { oreYield: 3 },
  modules: MODULES,
};

describe('MapAdditionsFile', () => {
  it('reads a file of its own version, every part optional', () => {
    expect(MapAdditionsFile.parse(FILE)).toEqual(FILE);
    expect(MapAdditionsFile.parse({ version: MAP_ADDITIONS_VERSION })).toEqual({
      version: MAP_ADDITIONS_VERSION,
    });
  });

  it('reads exactly its own version', () => {
    for (const version of [MAP_ADDITIONS_VERSION - 1, MAP_ADDITIONS_VERSION + 1, undefined])
      expect(MapAdditionsFile.safeParse({ ...FILE, version }).success).toBe(false);
  });

  it('refuses a key it does not know, at every level', () => {
    for (const bad of [
      { ...FILE, extra: true },
      { ...FILE, mode: { ...FILE.mode, extra: true } },
      { ...FILE, roomDefaults: { ...FILE.roomDefaults, basicYield: 2 } },
      { ...FILE, modules: { ...FILE.modules, extra: { version: 1 } } },
    ])
      expect(MapAdditionsFile.safeParse(bad).success).toBe(false);
  });
});
