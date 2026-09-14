import { memoryVfs } from '@open-northland/vfs/memory';
import { describe, expect, it } from 'vitest';
import { copySoundTree } from '../src/stages/sounds.js';

const MOD = 'mod';
const OUT = 'out';

async function modWith(files: readonly string[]): Promise<ReturnType<typeof memoryVfs>> {
  const fs = memoryVfs();
  await fs.mkdir(`${MOD}/DataCnmd`);
  for (const [i, rel] of files.entries()) await fs.writeFile(`${MOD}/${rel}`, Uint8Array.of(i + 1));
  return fs;
}

describe('copySoundTree', () => {
  it('copies the sounds tree to the served spelling the IR references', async () => {
    const fs = await modWith([
      'Data/Engine2D/bin/Sounds/Static/Axe01.WAV',
      'data/engine2d/bin/sounds/gui/click_confirm.wav',
    ]);
    const copied = await copySoundTree(fs, { mod: MOD, modVersion: undefined }, OUT);
    expect(copied.sort()).toEqual([
      'Data/engine2d/bin/sounds/gui/click_confirm.wav',
      'Data/engine2d/bin/sounds/static/axe01.wav',
    ]);
    expect([...(await fs.readFile(`${OUT}/Data/engine2d/bin/sounds/static/axe01.wav`))]).toEqual([1]);
  });

  it('leaves wavs outside the sounds tree and non-wav files inside it alone', async () => {
    const fs = await modWith([
      'CnModMaps/some_map/briefing.wav',
      'Data/engine2d/bin/sounds/soundfx.cif',
      'Data/engine2d/bin/sounds/misc/thunder.wav',
    ]);
    const copied = await copySoundTree(fs, { mod: MOD, modVersion: undefined }, OUT);
    expect(copied).toEqual(['Data/engine2d/bin/sounds/misc/thunder.wav']);
    expect(await fs.stat(`${OUT}/CnModMaps/some_map/briefing.wav`)).toBeUndefined();
  });
});
