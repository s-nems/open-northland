import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { statIfExists } from '../src/files.js';
import { copySoundTree } from '../src/stages/sounds.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

describe('copySoundTree', () => {
  let temp: GameOutTemp;

  beforeEach(async () => {
    temp = await makeGameOutTemp('sounds');
  });

  afterEach(() => temp.cleanup());

  async function modWith(files: readonly string[]): Promise<void> {
    for (const [i, rel] of files.entries()) await temp.write(rel, Uint8Array.of(i + 1));
  }

  it('copies the sounds tree to sounds/ at the lower-cased spelling the IR references', async () => {
    await modWith([
      'Data/Engine2D/bin/Sounds/Static/Axe01.WAV',
      'data/engine2d/bin/sounds/gui/click_confirm.wav',
    ]);
    const copied = await copySoundTree({ mod: temp.game, modVersion: undefined }, temp.out);
    expect(copied.sort()).toEqual(['sounds/gui/click_confirm.wav', 'sounds/static/axe01.wav']);
    expect([...(await readFile(join(temp.out, 'sounds', 'static', 'axe01.wav')))]).toEqual([1]);
  });

  it('leaves wavs outside the sounds tree and non-wav files inside it alone', async () => {
    await modWith([
      'CnModMaps/some_map/briefing.wav',
      'Data/engine2d/bin/sounds/soundfx.cif',
      'Data/engine2d/bin/sounds/misc/thunder.wav',
    ]);
    const copied = await copySoundTree({ mod: temp.game, modVersion: undefined }, temp.out);
    expect(copied).toEqual(['sounds/misc/thunder.wav']);
    expect(await statIfExists(join(temp.out, 'CnModMaps', 'some_map', 'briefing.wav'))).toBeUndefined();
  });
});
