import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VertexPalette } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodePcx } from '../src/decoders/pcx.js';
import { convertVertexPalette, VERTEX_PALETTE_FILE } from '../src/stages/vertex-palette.js';
import { rampPalette } from './fixtures/palette.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

describe('convertVertexPalette', () => {
  let temp: GameOutTemp;

  beforeEach(async () => {
    temp = await makeGameOutTemp('vertex-palette');
  });

  afterEach(() => temp.cleanup());

  it('writes the PCX colour table as 256 packed RGB entries, whatever the picture shows', async () => {
    await temp.write(
      'Data/Engine2D/bin/Palettes/misc/VertexColors.pcx',
      encodePcx({ width: 1, height: 1, pixels: Uint8Array.of(3), palette: rampPalette() }),
    );
    const colors = await convertVertexPalette({ mod: temp.game }, temp.out);
    expect(colors).toHaveLength(256);
    expect(colors[1]).toBe(0x01fe07);
    const written = await readFile(join(temp.out, VERTEX_PALETTE_FILE), 'utf8');
    expect(VertexPalette.parse(JSON.parse(written))).toEqual(colors);
  });

  it('fails the run when the mod ships no palette picture or one without a colour table', async () => {
    await mkdir(join(temp.game, 'DataCnmd'));
    await expect(convertVertexPalette({ mod: temp.game }, temp.out)).rejects.toThrow(
      /vertexcolors\.pcx not found/,
    );
    await temp.write(
      'Data/engine2d/bin/palettes/misc/vertexcolors.pcx',
      encodePcx({ width: 1, height: 1, pixels: Uint8Array.of(0) }),
    );
    await expect(convertVertexPalette({ mod: temp.game }, temp.out)).rejects.toThrow(/no colour table/);
  });
});
