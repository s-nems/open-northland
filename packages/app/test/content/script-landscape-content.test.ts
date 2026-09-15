import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, VertexPalette } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { scriptLandscapeTypes } from '../../src/content/script-landscape.js';
import { resolveMissionScript } from '../../src/game/world/mission-script.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

describe.runIf(hasRealIr())('script landscape content joins', () => {
  it('resolves every authored SetLandscape to a numeric catalog graphic', () => {
    const ir = rawIrUnderTest() as ContentIr;
    const ids = new Set(scriptLandscapeTypes(ir).map((type) => type.typeId));
    const maps = resolve(contentDir(), 'maps');
    let placements = 0;
    for (const file of readdirSync(maps).filter((name) => name.endsWith('.script.json'))) {
      const script = MapScript.parse(JSON.parse(readFileSync(resolve(maps, file), 'utf8')));
      for (const mission of resolveMissionScript(script.missions, ir).script.missions) {
        for (const op of mission.results) {
          if (op.opcode !== 'SetLandscape') continue;
          expect(ids.has(op.landscape), `${file}: unresolved landscape`).toBe(true);
          placements++;
        }
      }
    }
    expect(placements).toBeGreaterThan(0);
  });

  const palettePath = resolve(contentDir(), 'terrain-palettes/vertexcolors.json');
  it.skipIf(!existsSync(palettePath))(
    'ships the vertex palette as 256 RGB entries rather than a grayscale ramp',
    () => {
      const palette = VertexPalette.parse(JSON.parse(readFileSync(palettePath, 'utf8')));
      expect(palette.some((rgb) => ((rgb >> 16) & 255) !== (rgb & 255))).toBe(true);
    },
  );
});
