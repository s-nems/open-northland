import { describe, expect, it } from 'vitest';
import { gfxHouseRecords, parseIniSections } from '../../../src/ini.js';

function linesOf(ini: string): string[] {
  const [record] = [...gfxHouseRecords(parseIniSections(ini))];
  return (record?.props ?? []).map((p) => [p.key, ...p.values].join(' '));
}

describe('gfxHouseRecords', () => {
  it('repeats the level below for a declared level no GfxBobId draws, keeping the lines it sets', () => {
    const lines = linesOf(`[GfxHouse]
EditName "pottery"
LogicMaximumSize 3
LogicType 0 20
LogicType 1 21
LogicType 2 22
LogicBuildBlockArea 1 0 4
logichitpoints 1 35000
LogicConstructionGoods 1 4 5
LogicConstructionGoods 2 24 24 26
LogicDoorPoint 1 3 4
LogicDoorPoint 2 5 6
GfxBobId 0 0
GfxBobId 1 10
GfxSmokePoint 1 10 20 0
GfxSmokePoint 1 11 21 0
`);

    expect(lines.slice(-4)).toEqual([
      'logichitpoints 2 35000',
      'GfxBobId 2 10',
      'GfxSmokePoint 2 10 20 0',
      'GfxSmokePoint 2 11 21 0',
    ]);
    expect(lines.filter((line) => line.startsWith('LogicDoorPoint 2'))).toEqual(['LogicDoorPoint 2 5 6']);
    expect(lines.filter((line) => line.startsWith('LogicConstructionGoods 2'))).toEqual([
      'LogicConstructionGoods 2 24 24 26',
    ]);
    expect(lines.filter((line) => line.startsWith('LogicBuildBlockArea'))).toHaveLength(1);
  });

  it('leaves a record alone when every declared level is drawn or none is', () => {
    const drawn = `[GfxHouse]
EditName home
LogicType 0 2
LogicType 1 3
logichitpoints 0 1000
GfxBobId 0 1
GfxBobId 1 2
`;
    const undrawn = `[GfxHouse]
EditName home
LogicType 0 2
LogicType 1 3
logichitpoints 0 1000
`;
    for (const ini of [drawn, undrawn]) {
      expect(linesOf(ini)).toEqual(ini.trim().split('\n').slice(1));
    }
  });
});
