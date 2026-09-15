import { VertexPalette } from '@open-northland/data';
import { readText } from '@open-northland/vfs';
import { memoryVfs } from '@open-northland/vfs/memory';
import { describe, expect, it } from 'vitest';
import { encodePcx } from '../src/decoders/pcx.js';
import { convertVertexPalette, VERTEX_PALETTE_FILE } from '../src/stages/vertex-palette.js';
import { rampPalette } from './fixtures/palette.js';

const MOD = 'mod';
const OUT = 'out';
const roots = { mod: MOD, modVersion: undefined };

describe('convertVertexPalette', () => {
  it('writes the PCX colour table as 256 packed RGB entries, whatever the picture shows', async () => {
    const fs = memoryVfs();
    await fs.writeFile(
      `${MOD}/Data/Engine2D/bin/Palettes/misc/VertexColors.pcx`,
      encodePcx({ width: 1, height: 1, pixels: Uint8Array.of(3), palette: rampPalette() }),
    );
    const colors = await convertVertexPalette(fs, roots, OUT);
    expect(colors).toHaveLength(256);
    expect(colors[1]).toBe(0x01fe07);
    expect(VertexPalette.parse(JSON.parse(await readText(fs, `${OUT}/${VERTEX_PALETTE_FILE}`)))).toEqual(
      colors,
    );
  });

  it('fails the run when the mod ships no palette picture or one without a colour table', async () => {
    const fs = memoryVfs();
    await fs.mkdir(`${MOD}/DataCnmd`);
    await expect(convertVertexPalette(fs, roots, OUT)).rejects.toThrow(/vertexcolors\.pcx not found/);
    await fs.writeFile(
      `${MOD}/Data/engine2d/bin/palettes/misc/vertexcolors.pcx`,
      encodePcx({ width: 1, height: 1, pixels: Uint8Array.of(0) }),
    );
    await expect(convertVertexPalette(fs, roots, OUT)).rejects.toThrow(/no colour table/);
  });
});
